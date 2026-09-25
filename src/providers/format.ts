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

const TOOL_LINE_PREFIX = `${ANSI.cyan}${ANSI.bold}> `;

export function formatToolUse(name: string, input: Record<string, unknown>): string {
  const label = `${TOOL_LINE_PREFIX}${name}${ANSI.reset}`;
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
    case "Agent":
      detail = `${ANSI.magenta}${input.description ?? input.subagent_type ?? ""}${ANSI.reset}`;
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

export function compactOutput(output: string, max: number): string {
  if (output.length <= max) return output;

  const lines = output.split("\n");
  const dropped = new Array<boolean>(lines.length).fill(false);
  const budget = max - 64;
  let length = output.length;
  let omitted = 0;
  let firstDropped = -1;
  for (let i = 0; i < lines.length && length > budget; i++) {
    if (!lines[i].startsWith(TOOL_LINE_PREFIX)) continue;
    dropped[i] = true;
    length -= lines[i].length + 1;
    omitted++;
    if (firstDropped < 0) firstDropped = i;
    if (lines[i + 1] === "") {
      dropped[i + 1] = true;
      length -= 1;
    }
  }

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === firstDropped) kept.push(`${ANSI.dim}...(${omitted} tool calls omitted)${ANSI.reset}`);
    if (!dropped[i]) kept.push(lines[i]);
  }

  return kept.join("\n");
}
