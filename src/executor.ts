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
    "--verbose",
    "--dangerously-skip-permissions",
    "--output-format",
    "stream-json",
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
                resultText += block.text;
                resultTextSize += block.text.length;
                onChunk?.(block.text);
              }
            }
          } else if (event.type === "result") {
            resultData = {
              output: event.result ?? resultText,
              sessionId: event.session_id ?? "",
              durationMs: event.duration_ms ?? 0,
              costUsd: event.total_cost_usd ?? 0,
              isError: event.is_error ?? false,
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
        reject(new Error("Claude CLI não encontrado no PATH."));
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
