import { spawn } from "node:child_process";
import { config } from "./config.js";

export type { AskQuestion } from "./providers/types.js";

interface ShellResult {
  output: string;
  exitCode: number;
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
