import { type ChildProcess, spawn } from "node:child_process";
import { config } from "./config.js";

export interface ClaudeResult {
  output: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  isError: boolean;
}

export interface SpawnHandle {
  process: ChildProcess;
  promise: Promise<ClaudeResult>;
}

export function spawnClaude(
  prompt: string,
  cwd: string,
  resumeSessionId?: string | null,
  timeoutMs?: number,
  onChunk?: (chunk: string) => void,
): SpawnHandle {
  const timeout = timeoutMs ?? config.claudeTimeoutMs;
  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--output-format",
    "json",
  ];

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  args.push(prompt);

  const proc = spawn("claude", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const promise = new Promise<ClaudeResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let bufferExceeded = false;

    proc.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (stdout.length < config.maxBufferSize) {
        stdout += text;
        onChunk?.(text);
      } else if (!bufferExceeded) {
        bufferExceeded = true;
        proc.kill("SIGTERM");
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
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
    }, timeout);

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error("Claude CLI não encontrado no PATH."));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

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

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          output: parsed.result ?? "",
          sessionId: parsed.session_id ?? "",
          durationMs: parsed.duration_ms ?? 0,
          costUsd: parsed.total_cost_usd ?? 0,
          isError: parsed.is_error ?? false,
        });
      } catch {
        if (code !== 0) {
          reject(
            new Error(
              `Processo encerrado (exit code: ${code}).${stderr ? ` stderr: ${stderr}` : ""}`,
            ),
          );
        } else {
          resolve({
            output: stdout || "",
            sessionId: "",
            durationMs: 0,
            costUsd: 0,
            isError: false,
          });
        }
      }
    });
  });

  return { process: proc, promise };
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
