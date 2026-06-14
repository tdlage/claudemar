import { config } from "../config.js";
import { ANSI } from "./format.js";
import type {
  AgentResult,
  LineParser,
  ParserCallbacks,
  ProviderAdapter,
  SpawnOptions,
} from "./types.js";

const READ_ONLY_CONFIG = 'sandbox_mode="read-only"';

function formatItem(item: Record<string, any>): string | null {
  const label = (name: string) => `${ANSI.cyan}${ANSI.bold}> ${name}${ANSI.reset}`;

  switch (item.type) {
    case "command_execution":
      return `\n${label("Shell")} ${ANSI.dim}${String(item.command ?? "").slice(0, 120)}${ANSI.reset}\n`;
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const detail = changes
        .map((c: Record<string, unknown>) => `${c.kind ?? ""} ${c.path ?? ""}`.trim())
        .join(", ")
        .slice(0, 200);
      return `\n${label("Edit")} ${ANSI.yellow}${detail}${ANSI.reset}\n`;
    }
    case "mcp_tool_call":
      return `\n${label("MCP")} ${ANSI.magenta}${[item.server, item.tool].filter(Boolean).join(".")}${ANSI.reset}\n`;
    case "web_search":
      return `\n${label("WebSearch")} ${ANSI.gray}${item.query ?? ""}${ANSI.reset}\n`;
    default:
      return null;
  }
}

export const codexProvider: ProviderAdapter = {
  name: "codex",
  binary: "codex",
  displayName: "Codex CLI",

  buildArgs(opts: SpawnOptions): string[] {
    const args = ["exec"];

    if (opts.resumeSessionId) {
      args.push("resume", opts.resumeSessionId);
    }

    args.push("--json", "--skip-git-repo-check");

    if (opts.inDocker) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else if (opts.planMode) {
      args.push("-c", READ_ONLY_CONFIG);
    } else {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }

    if (opts.model && opts.model !== "codex") {
      args.push("-m", opts.model);
    }

    const prompt = opts.inDocker && opts.planMode
      ? `${opts.prompt}\n\n[SYSTEM: read-only mode — do not modify, create or delete any files and do not run commands with side effects.]`
      : opts.prompt;

    args.push(prompt);
    return args;
  },

  dockerArgs(): string[] {
    return ["-v", `${config.codexConfigDir}:/home/claude-user/.codex`];
  },

  createParser(callbacks: ParserCallbacks): LineParser {
    const startTime = Date.now();
    let sessionId = "";
    let resultText = "";
    let totalTokens = 0;
    let isError = false;
    let sawEvent = false;
    const errorMessages: string[] = [];

    const pushError = (message: unknown) => {
      const text = String(message);
      if (text && !errorMessages.includes(text)) {
        errorMessages.push(text);
      }
    };

    return {
      feedLine(line: string): void {
        let event: Record<string, any>;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        sawEvent = true;

        if (event.type === "thread.started" && event.thread_id) {
          sessionId = event.thread_id;
          callbacks.onSessionId?.(sessionId);
        } else if (event.type === "item.started" && event.item) {
          const formatted = formatItem(event.item);
          if (formatted) callbacks.onChunk?.(formatted);
        } else if (event.type === "item.completed" && event.item) {
          const item = event.item;
          if (item.type === "agent_message" && item.text) {
            const needsNewline = resultText.length > 0 && !resultText.endsWith("\n") && !item.text.startsWith("\n");
            if (needsNewline) {
              resultText += "\n";
              callbacks.onChunk?.("\n");
            }
            resultText += item.text;
            callbacks.onChunk?.(item.text);
          } else if (item.type === "error") {
            isError = true;
            pushError(item.message ?? JSON.stringify(item));
          }
        } else if (event.type === "turn.completed" && event.usage) {
          totalTokens += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
        } else if (event.type === "turn.failed") {
          isError = true;
          pushError(event.error?.message ?? "turn failed");
        } else if (event.type === "error") {
          isError = true;
          pushError(event.message ?? "unknown error");
        }
      },

      partialOutput(): string {
        return resultText;
      },

      finish(exitCode: number | null): AgentResult | null {
        if (!sawEvent) return null;
        if (exitCode !== 0 && !isError) return null;
        return {
          output: resultText,
          sessionId,
          durationMs: Date.now() - startTime,
          costUsd: 0,
          totalTokens,
          isError,
          errorMessages,
          permissionDenials: [],
        };
      },
    };
  },
};
