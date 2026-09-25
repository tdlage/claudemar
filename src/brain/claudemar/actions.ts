import { relative, sep } from "node:path";
import { stripAnsi } from "../../codex/auth.js";

export type ToolActionKind = "write" | "edit" | "delete" | "command" | "subagent" | "web" | "tool" | "question" | "plan";

export interface ToolAction {
  kind: ToolActionKind;
  detail: string;
}

const IGNORED_CLAUDE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "TodoWrite",
  "TaskOutput",
  "BashOutput",
  "KillShell",
  "KillBash",
  "ToolSearch",
  "EnterPlanMode",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
]);

const SHELL_FUNCTIONS = new Set(["shell", "container.exec", "exec_command", "local_shell", "unified_exec"]);

const FORMATTED_TOOL_RE = /^> ([A-Za-z][\w.:-]*)(?: (.*))?$/;
const PATCH_FILE_RE = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function patchActions(patch: string): ToolAction[] {
  const actions: ToolAction[] = [];
  for (const match of patch.matchAll(PATCH_FILE_RE)) {
    const kind: ToolActionKind = match[1] === "Add" ? "write" : match[1] === "Delete" ? "delete" : "edit";
    actions.push({ kind, detail: match[2].trim() });
  }
  return actions;
}

export function shellCommandText(command: unknown): string {
  if (typeof command === "string") return command.trim();
  if (!Array.isArray(command)) return "";
  const parts = command.filter((part): part is string => typeof part === "string");
  if (parts.length >= 3 && /(^|\/)(ba|z)?sh$/.test(parts[0]) && /^-l?c$/.test(parts[1])) return parts.slice(2).join(" ").trim();
  return parts.join(" ").trim();
}

function commandActions(command: string): ToolAction[] {
  if (!command) return [];
  const patched = /\bapply_patch\b/.test(command) ? patchActions(command) : [];
  return patched.length > 0 ? patched : [{ kind: "command", detail: command }];
}

export function claudeToolAction(name: string, input: Record<string, unknown>): ToolAction | null {
  if (IGNORED_CLAUDE_TOOLS.has(name)) return null;
  switch (name) {
    case "Write":
      return str(input.file_path) ? { kind: "write", detail: str(input.file_path) } : null;
    case "Edit":
    case "MultiEdit":
      return str(input.file_path) ? { kind: "edit", detail: str(input.file_path) } : null;
    case "NotebookEdit":
      return str(input.notebook_path) ? { kind: "edit", detail: str(input.notebook_path) } : null;
    case "Bash":
      return str(input.command) ? { kind: "command", detail: str(input.command) } : null;
    case "Task":
    case "Agent":
      return { kind: "subagent", detail: str(input.description) || str(input.subagent_type) || name };
    case "WebFetch":
      return str(input.url) ? { kind: "web", detail: str(input.url) } : null;
    case "WebSearch":
      return str(input.query) ? { kind: "web", detail: str(input.query) } : null;
    case "AskUserQuestion": {
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const text = questions
        .map((q) => (q && typeof q === "object" ? str((q as Record<string, unknown>).question) : ""))
        .filter(Boolean)
        .join(" | ");
      return text ? { kind: "question", detail: text } : null;
    }
    case "ExitPlanMode":
      return str(input.plan) ? { kind: "plan", detail: str(input.plan) } : null;
    default:
      return { kind: "tool", detail: name };
  }
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function codexFunctionActions(name: string, namespace: string, rawArguments: unknown): ToolAction[] {
  const args = parseArguments(rawArguments);
  if (name === "apply_patch") return patchActions(str(args.input) || str(args.patch) || str(rawArguments));
  if (SHELL_FUNCTIONS.has(name)) return commandActions(shellCommandText(args.command ?? args.cmd));
  if (name === "update_plan" || name === "view_image") return [];
  return [{ kind: "tool", detail: namespace ? `${namespace}.${name}` : name }];
}

export function codexCustomToolActions(name: string, input: string): ToolAction[] {
  if (name === "apply_patch") return patchActions(input);
  return [{ kind: "tool", detail: name }];
}

export function codexShellActions(command: unknown): ToolAction[] {
  return commandActions(shellCommandText(command));
}

const FORMATTED_KNOWN = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "ExitPlanMode",
  ...IGNORED_CLAUDE_TOOLS,
]);

function formattedAction(name: string, detail: string): ToolAction | null {
  if (!FORMATTED_KNOWN.has(name) && !name.startsWith("mcp__")) return null;
  if (IGNORED_CLAUDE_TOOLS.has(name)) return { kind: "tool", detail: "" };
  switch (name) {
    case "Write":
      return { kind: "write", detail };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { kind: "edit", detail };
    case "Bash":
      return { kind: "command", detail };
    case "Task":
    case "Agent":
      return { kind: "subagent", detail: detail || name };
    case "WebFetch":
    case "WebSearch":
      return { kind: "web", detail };
    case "AskUserQuestion":
      return { kind: "question", detail };
    case "ExitPlanMode":
      return { kind: "plan", detail };
    default:
      return { kind: "tool", detail: name };
  }
}

/** Separa o texto do assistente das linhas "> Ferramenta detalhe" que o execution-manager intercala no output. */
export function splitFormattedOutput(output: string): { text: string; actions: ToolAction[] } {
  const actions: ToolAction[] = [];
  const kept: string[] = [];
  for (const line of stripAnsi(output).split("\n")) {
    const match = FORMATTED_TOOL_RE.exec(line.trim());
    const action = match ? formattedAction(match[1], (match[2] ?? "").trim()) : null;
    if (!action) {
      kept.push(line);
      continue;
    }
    if (action.detail) actions.push(action);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), actions };
}

function relativePath(path: string, root: string | null): string {
  if (!root || !path.startsWith(root + sep)) return path;
  return relative(root, path);
}

const GIT_COMMIT_RE = /\bgit\b[^\n|;&]{0,200}?\bcommit\b/;
const MESSAGE_FLAG_RE = /(?:^|\s)(?:-[a-zA-Z]*m|--message)(?:=|\s{1,5})/;
const HEREDOC_RE = /^"?\$\(cat <<-?['"]?(\w{1,20})['"]?\s*\n/;

function quotedValue(text: string): string | null {
  const quote = text[0];
  if (quote !== '"' && quote !== "'") return text.split(/\s/, 1)[0] || null;
  const end = text.indexOf(quote, 1);
  return end > 1 ? text.slice(1, end) : null;
}

export function commitMessageOf(command: string): string | null {
  const commit = GIT_COMMIT_RE.exec(command);
  if (!commit) return null;
  const rest = command.slice(commit.index + commit[0].length);
  const flag = MESSAGE_FLAG_RE.exec(rest);
  if (!flag) return null;
  const value = rest.slice(flag.index + flag[0].length);
  const heredoc = HEREDOC_RE.exec(value);
  const message = heredoc ? value.slice(heredoc[0].length).split("\n", 1)[0] : quotedValue(value);
  return message?.split("\n")[0].trim() || null;
}

function uniqueCounted(items: string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].map(([item, count]) => (count > 1 ? `${item} ×${count}` : item));
}

function capped(items: string[], max: number): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} (+${items.length - max})` : shown;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const MAX_PLAN_CHARS = 4000;

export function summarizeActions(actions: ToolAction[], root: string | null): string {
  const byKind = (kind: ToolActionKind) => actions.filter((a) => a.kind === kind).map((a) => a.detail).filter(Boolean);
  const files = (kind: ToolActionKind) => [...new Set(byKind(kind).map((p) => relativePath(p, root)))];
  const commands = byKind("command");
  const commits = commands.map(commitMessageOf).filter((m): m is string => Boolean(m));
  const lines: string[] = [];

  const written = files("write");
  const edited = files("edit").filter((p) => !written.includes(p));
  const deleted = files("delete");
  if (written.length > 0) lines.push(`- Arquivos criados/reescritos (${written.length}): ${capped(written, 25)}`);
  if (edited.length > 0) lines.push(`- Arquivos editados (${edited.length}): ${capped(edited, 25)}`);
  if (deleted.length > 0) lines.push(`- Arquivos removidos (${deleted.length}): ${capped(deleted, 15)}`);
  if (commits.length > 0) lines.push(`- Commits: ${commits.map((m) => `"${oneLine(m, 140)}"`).join("; ")}`);
  if (commands.length > 0) {
    const shown = uniqueCounted(commands.map((c) => oneLine(c, 160)));
    lines.push(`- Comandos (${commands.length}): ${shown.slice(0, 12).map((c) => `\`${c.replace(/`/g, "'")}\``).join(" · ")}${shown.length > 12 ? ` (+${shown.length - 12})` : ""}`);
  }
  const subagents = byKind("subagent");
  if (subagents.length > 0) lines.push(`- Subagentes: ${capped(uniqueCounted(subagents.map((s) => oneLine(s, 100))), 10)}`);
  const web = byKind("web");
  if (web.length > 0) lines.push(`- Web: ${capped(uniqueCounted(web.map((w) => oneLine(w, 120))), 10)}`);
  const tools = byKind("tool");
  if (tools.length > 0) lines.push(`- Ferramentas: ${capped(uniqueCounted(tools), 15)}`);
  const questions = byKind("question");
  if (questions.length > 0) lines.push(`- Perguntas ao usuário: ${questions.map((q) => oneLine(q, 200)).join(" | ")}`);

  const plans = byKind("plan");
  if (plans.length > 0) {
    const plan = plans[plans.length - 1];
    lines.push("", "Plano apresentado:", plan.length > MAX_PLAN_CHARS ? `${plan.slice(0, MAX_PLAN_CHARS)}\n[plano truncado]` : plan);
  }
  return lines.join("\n");
}
