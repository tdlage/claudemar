function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function formatToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return str(input.file_path ?? input.notebook_path);
    case "Bash":
      return str(input.command);
    case "Glob":
    case "Grep":
      return str(input.pattern);
    case "Task":
      return str(input.description);
    case "WebFetch":
      return str(input.url);
    case "WebSearch":
      return str(input.query);
    case "AskUserQuestion": {
      const qs = input.questions as Array<{ question?: string }> | undefined;
      return str(qs?.[0]?.question);
    }
    default: {
      const json = JSON.stringify(input);
      return json === "{}" ? "" : json;
    }
  }
}
