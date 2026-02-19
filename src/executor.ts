import { type ChildProcess, spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { config } from "./config.js";

export interface QuestionOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: { questions: AskQuestion[] };
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

function formatToolUse(name: string, input: Record<string, unknown>): string {
  const label = `${ANSI.cyan}${ANSI.bold}> ${name}${ANSI.reset}`;
  let detail = "";

  switch (name) {
    case "Read":
      detail = `${ANSI.gray}${input.file_path ?? ""}${ANSI.reset}`;
      break;
    case "Write":
      detail = `${ANSI.yellow}${input.file_path ?? ""}${ANSI.reset}`;
      break;
    case "Edit":
      detail = `${ANSI.yellow}${input.file_path ?? ""}${ANSI.reset}`;
      break;
    case "Bash":
      detail = `${ANSI.dim}${String(input.command ?? "").slice(0, 120)}${ANSI.reset}`;
      break;
    case "Glob":
      detail = `${ANSI.gray}${input.pattern ?? ""}${ANSI.reset}`;
      break;
    case "Grep":
      detail = `${ANSI.gray}${input.pattern ?? ""}${ANSI.reset}`;
      break;
    case "Task":
      detail = `${ANSI.magenta}${input.description ?? ""}${ANSI.reset}`;
      break;
    case "AskUserQuestion": {
      const qs = input.questions as Array<{ question: string }> | undefined;
      const preview = qs?.[0]?.question?.slice(0, 100) ?? "";
      detail = `${ANSI.yellow}${preview}${ANSI.reset}`;
      break;
    }
    default:
      detail = `${ANSI.dim}${JSON.stringify(input).slice(0, 100)}${ANSI.reset}`;
  }

  return `\n${label} ${detail}\n`;
}

export interface ClaudeResult {
  output: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  isError: boolean;
  permissionDenials: PermissionDenial[];
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
  model?: string,
  onQuestion?: (toolUseId: string, questions: AskQuestion[]) => void,
  planMode?: boolean,
  agentName?: string,
  useDocker?: boolean,
): SpawnHandle {
  const timeout = timeoutMs ?? config.claudeTimeoutMs;
  const claudeArgs = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
  ];

  if (planMode) {
    claudeArgs.push("--permission-mode", "plan");
  } else {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  if (model) {
    claudeArgs.push("--model", model);
  }

  if (agentName) {
    claudeArgs.push("--agent", agentName);
  }

  if (resumeSessionId) {
    claudeArgs.push("--resume", resumeSessionId);
  }

  claudeArgs.push(prompt);

  let proc: ChildProcess;

  if (useDocker) {
    const escapedArgs = claudeArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    const dockerArgs = [
      "run", "--rm",
      "-u", `${uid}:${gid}`,
      "--cap-add=NET_ADMIN", "--cap-add=NET_RAW",
      "-v", `${cwd}:${cwd}`,
      "-v", `${config.claudeConfigDir}:/home/claude-user/.claude`,
      "-v", `${resolve(homedir(), ".claude.json")}:/home/claude-user/.claude.json:ro`,
      "-w", cwd,
      "-e", "HOME=/home/claude-user",
      "-e", "NODE_OPTIONS=--max-old-space-size=4096",
      config.dockerImage,
      "bash", "-c",
      `sudo /usr/local/bin/init-firewall.sh 2>/dev/null; claude ${escapedArgs}`,
    ];
    proc = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    proc = spawn("claude", claudeArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: undefined,
    });
  }

  const promise = new Promise<ClaudeResult>((resolve, reject) => {
    let stderr = "";
    let bufferExceeded = false;
    let lineBuffer = "";
    let resultTextSize = 0;
    let resultText = "";
    let resultData: ClaudeResult | null = null;

    proc.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (resultTextSize >= config.maxBufferSize) {
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
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                const needsNewline = resultText.length > 0 && !resultText.endsWith("\n") && !block.text.startsWith("\n");
                if (needsNewline) {
                  resultText += "\n";
                  resultTextSize += 1;
                  onChunk?.("\n");
                }
                resultText += block.text;
                resultTextSize += block.text.length;
                onChunk?.(block.text);
              } else if (block.type === "tool_use" && block.name) {
                if (block.name === "AskUserQuestion" && block.input?.questions) {
                  onQuestion?.(block.id, block.input.questions as AskQuestion[]);
                }
                const formatted = formatToolUse(block.name, block.input ?? {});
                onChunk?.(formatted);
              }
            }
          } else if (event.type === "result") {
            const denials: PermissionDenial[] = [];
            if (Array.isArray(event.permission_denials)) {
              for (const d of event.permission_denials) {
                if (d.tool_name === "AskUserQuestion" && d.tool_input?.questions) {
                  denials.push(d as PermissionDenial);
                }
              }
            }
            resultData = {
              output: event.result ?? resultText,
              sessionId: event.session_id ?? "",
              durationMs: event.duration_ms ?? 0,
              costUsd: event.total_cost_usd ?? 0,
              isError: event.is_error ?? false,
              permissionDenials: denials,
            };
          }
        } catch {
          // non-JSON line, ignore
        }
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
          : "Claude CLI não encontrado no PATH."));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);

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

      if (resultData) {
        resolve(resultData);
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Processo encerrado (exit code: ${code}).${stderr ? ` stderr: ${stderr}` : ""}`,
          ),
        );
      } else {
        resolve({
          output: resultText || "",
          sessionId: "",
          durationMs: 0,
          costUsd: 0,
          isError: false,
          permissionDenials: [],
        });
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
