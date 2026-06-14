import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { config } from "../config.js";
import { ANSI } from "./format.js";
import type {
  AgentResult,
  AskQuestion,
  LineParser,
  ParserCallbacks,
  PermissionDenial,
  ProviderAdapter,
  SpawnOptions,
} from "./types.js";

const DOCKER_CONFIG_DIR = resolve(config.basePath, ".docker-claude-config");

function ensureDockerClaudeConfig(): string {
  mkdirSync(DOCKER_CONFIG_DIR, { recursive: true });

  const claudeJsonPath = resolve(homedir(), ".claude.json");
  const dockerClaudeJsonPath = resolve(DOCKER_CONFIG_DIR, "claude.json");

  try {
    const raw = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
    delete raw.mcpServers;
    writeFileSync(dockerClaudeJsonPath, JSON.stringify(raw));
  } catch {
    writeFileSync(dockerClaudeJsonPath, "{}");
  }

  const settingsPath = resolve(DOCKER_CONFIG_DIR, "settings.json");
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, "{}");
  }

  return DOCKER_CONFIG_DIR;
}

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

export const claudeProvider: ProviderAdapter = {
  name: "claude",
  binary: "claude",
  displayName: "Claude CLI",

  buildArgs(opts: SpawnOptions): string[] {
    const args = ["--print", "--verbose", "--output-format", "stream-json"];

    if (opts.planMode) {
      args.push("--permission-mode", "plan");
    } else {
      args.push("--dangerously-skip-permissions");
    }

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.agentName) {
      args.push("--agent", opts.agentName);
    }

    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    }

    args.push(opts.prompt);
    return args;
  },

  dockerArgs(): string[] {
    const dockerConfigDir = ensureDockerClaudeConfig();
    return [
      "-v", `${config.claudeConfigDir}:/home/claude-user/.claude`,
      "-v", `${resolve(dockerConfigDir, "settings.json")}:/home/claude-user/.claude/settings.json:ro`,
      "-v", `${resolve(dockerConfigDir, "claude.json")}:/home/claude-user/.claude.json:ro`,
    ];
  },

  createParser(callbacks: ParserCallbacks): LineParser {
    let resultText = "";
    let resultData: AgentResult | null = null;

    return {
      feedLine(line: string): void {
        let event: Record<string, any>;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }

        if (event.type === "system" && event.session_id) {
          callbacks.onSessionId?.(event.session_id);
        } else if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              const needsNewline = resultText.length > 0 && !resultText.endsWith("\n") && !block.text.startsWith("\n");
              if (needsNewline) {
                resultText += "\n";
                callbacks.onChunk?.("\n");
              }
              resultText += block.text;
              callbacks.onChunk?.(block.text);
            } else if (block.type === "tool_use" && block.name) {
              if (block.name === "AskUserQuestion" && block.input?.questions) {
                callbacks.onQuestion?.(block.id, block.input.questions as AskQuestion[]);
              }
              callbacks.onChunk?.(formatToolUse(block.name, block.input ?? {}));
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
          const errorMessages: string[] = Array.isArray(event.errors)
            ? event.errors.map((e: unknown) => String(e))
            : [];
          resultData = {
            output: event.result ?? resultText,
            sessionId: event.session_id ?? "",
            durationMs: event.duration_ms ?? 0,
            costUsd: event.total_cost_usd ?? 0,
            totalTokens: 0,
            isError: event.is_error ?? false,
            errorMessages,
            permissionDenials: denials,
          };
        }
      },

      partialOutput(): string {
        return resultText;
      },

      finish(): AgentResult | null {
        return resultData;
      },
    };
  },
};
