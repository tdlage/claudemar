import { type ChildProcess, spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "./config.js";
import { getProvider, resolveProvider } from "./providers/index.js";
import type { AgentResult, AskQuestion } from "./providers/index.js";

export type {
  AgentResult,
  AskQuestion,
  PermissionDenial,
  ProviderName,
  QuestionOption,
} from "./providers/index.js";
export { resolveProvider } from "./providers/index.js";

let dockerImageReady = false;

function ensureDockerImage(): void {
  if (dockerImageReady) return;
  try {
    execFileSync("docker", ["image", "inspect", config.dockerImage], { stdio: "ignore" });
    dockerImageReady = true;
  } catch {
    const dockerDir = resolve(config.installDir, "docker");
    console.log(`[executor] Building Docker image ${config.dockerImage} from ${dockerDir}...`);
    execFileSync("docker", ["build", "-t", config.dockerImage, dockerDir], { stdio: "inherit", timeout: 600_000 });
    dockerImageReady = true;
    console.log(`[executor] Docker image ${config.dockerImage} built successfully`);
  }
}

export function rebuildDockerImage(): void {
  dockerImageReady = false;
  try {
    execFileSync("docker", ["rmi", "-f", config.dockerImage], { stdio: "ignore" });
  } catch {}
  ensureDockerImage();
}

export interface SpawnHandle {
  process: ChildProcess;
  promise: Promise<AgentResult>;
  sessionId?: string;
}

export function spawnAgent(
  prompt: string,
  cwd: string,
  resumeSessionId?: string | null,
  timeoutMs?: number,
  onChunk?: (chunk: string) => void,
  model?: string,
  onQuestion?: (toolUseId: string, questions: AskQuestion[]) => void,
  planMode?: boolean,
  agentName?: string,
  useDocker?: boolean,
): SpawnHandle {
  const provider = getProvider(resolveProvider(model));
  const timeout = timeoutMs ?? config.agentTimeoutMs;
  const args = provider.buildArgs({
    prompt,
    model,
    resumeSessionId: resumeSessionId ?? undefined,
    planMode,
    agentName,
    inDocker: useDocker,
  });

  let proc: ChildProcess;

  if (useDocker) {
    ensureDockerImage();
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    const dockerArgs = [
      "run", "--rm",
      "--cap-add=NET_ADMIN", "--cap-add=NET_RAW",
      "-v", `${cwd}:${cwd}`,
      ...provider.dockerArgs(),
      "-w", cwd,
      "-e", "HOME=/home/claude-user",
      "-e", `CLAUDE_UID=${uid}`,
      "-e", `CLAUDE_GID=${gid}`,
      "-e", "NODE_OPTIONS=--max-old-space-size=4096",
      config.dockerImage,
      provider.binary, ...args,
    ];
    proc = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    proc = spawn(provider.binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: cleanEnv,
    });
  }

  let earlySessionId: string | undefined;

  const promise = new Promise<AgentResult>((resolve, reject) => {
    let stderr = "";
    let bufferExceeded = false;
    let lineBuffer = "";

    const parser = provider.createParser({
      onChunk,
      onQuestion,
      onSessionId: (sessionId) => {
        earlySessionId = sessionId;
      },
    });

    proc.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (parser.partialOutput().length >= config.maxBufferSize) {
        if (!bufferExceeded) {
          bufferExceeded = true;
          proc.kill("SIGTERM");
        }
        return;
      }
      lineBuffer += text;

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        parser.feedLine(trimmed);
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < config.maxBufferSize) {
        stderr += chunk.toString();
      }
    });

    let killed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 5000);
      }, timeout);
    }

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error(useDocker
          ? "Docker não encontrado no PATH. Instale o Docker ou desative o modo Docker."
          : `${provider.displayName} não encontrado no PATH.`));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);

      if (lineBuffer.trim()) {
        parser.feedLine(lineBuffer.trim());
      }

      if (bufferExceeded) {
        reject(new Error("Output excedeu o limite de buffer."));
        return;
      }

      if (killed) {
        reject(
          new Error(
            `Timeout após ${Math.round(timeout / 60000)} minutos.`,
          ),
        );
        return;
      }

      const resultData = parser.finish(code);

      if (resultData) {
        if (useDocker && stderr) {
          console.log(`[executor:docker] stderr: ${stderr.slice(0, 500)}`);
        }
        resolve(resultData);
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Processo encerrado (exit code: ${code}).${stderr ? ` stderr: ${stderr}` : ""}`,
          ),
        );
      } else if (useDocker) {
        reject(
          new Error(
            `Docker: processo finalizou sem output do ${provider.displayName}.${stderr ? ` stderr: ${stderr}` : ""}`,
          ),
        );
      } else {
        resolve({
          output: parser.partialOutput(),
          sessionId: "",
          durationMs: 0,
          costUsd: 0,
          totalTokens: 0,
          isError: false,
          errorMessages: [],
          permissionDenials: [],
        });
      }
    });
  });

  const handle: SpawnHandle = { process: proc, promise, get sessionId() { return earlySessionId; } };
  return handle;
}

interface ShellResult {
  output: string;
  exitCode: number;
}

export function executeShell(
  command: string,
  cwd: string,
  timeoutMs = 60000,
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let bufferExceeded = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < config.maxBufferSize) {
        stdout += chunk.toString();
      } else if (!bufferExceeded) {
        bufferExceeded = true;
        proc.kill("SIGTERM");
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < config.maxBufferSize) {
        stderr += chunk.toString();
      }
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      if (bufferExceeded) {
        reject(new Error("Output excedeu o limite de buffer."));
        return;
      }

      if (killed) {
        reject(new Error(`Timeout após ${Math.round(timeoutMs / 1000)}s.`));
        return;
      }

      const combined = stdout + (stderr ? `\n${stderr}` : "");
      resolve({ output: combined.trim(), exitCode: code ?? 1 });
    });
  });
}

export function executeSpawn(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 60000,
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let bufferExceeded = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < config.maxBufferSize) {
        stdout += chunk.toString();
      } else if (!bufferExceeded) {
        bufferExceeded = true;
        proc.kill("SIGTERM");
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < config.maxBufferSize) {
        stderr += chunk.toString();
      }
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      if (bufferExceeded) {
        reject(new Error("Output excedeu o limite de buffer."));
        return;
      }

      if (killed) {
        reject(new Error(`Timeout após ${Math.round(timeoutMs / 1000)}s.`));
        return;
      }

      const combined = stdout + (stderr ? `\n${stderr}` : "");
      resolve({ output: combined.trim(), exitCode: code ?? 1 });
    });
  });
}
