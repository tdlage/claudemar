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

export function formatToolUse(name: string, input: Record<string, unknown>): string {
  const label = `${ANSI.cyan}${ANSI.bold}> ${name}${ANSI.reset}`;
  let detail = "";

  switch (name) {
    case "Read":
      detail = `${ANSI.gray}${input.file_path ?? ""}${ANSI.reset}`;
      break;
    case "Write":
    case "Edit":
      detail = `${ANSI.yellow}${input.file_path ?? ""}${ANSI.reset}`;
      break;
    case "Bash":
      detail = `${ANSI.dim}${String(input.command ?? "").slice(0, 120)}${ANSI.reset}`;
      break;
    case "Glob":
    case "Grep":
      detail = `${ANSI.gray}${input.pattern ?? ""}${ANSI.reset}`;
      break;
    case "Task":
      detail = `${ANSI.magenta}${input.description ?? ""}${ANSI.reset}`;
      break;
    case "AskUserQuestion": {
      const qs = input.questions as Array<{ question: string }> | undefined;
      detail = `${ANSI.yellow}${qs?.[0]?.question?.slice(0, 100) ?? ""}${ANSI.reset}`;
      break;
    }
    default:
      detail = `${ANSI.dim}${JSON.stringify(input).slice(0, 100)}${ANSI.reset}`;
  }

  return `\n${label} ${detail}\n`;
}
