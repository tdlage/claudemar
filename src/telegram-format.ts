const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-Z]|\x1b[>=<]|\x9b[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(text: string): string {
  const cleaned = stripAnsi(text);
  const lines = cleaned.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    if (!inCodeBlock && line.match(/^```(\w*)/)) {
      inCodeBlock = true;
      codeBlockLang = line.replace(/^```/, "").trim();
      codeBlockLines = [];
      continue;
    }

    if (inCodeBlock && line.trimEnd() === "```") {
      inCodeBlock = false;
      const code = escapeHtml(codeBlockLines.join("\n"));
      if (codeBlockLang) {
        result.push(`<pre><code class="language-${escapeHtml(codeBlockLang)}">${code}</code></pre>`);
      } else {
        result.push(`<pre>${code}</pre>`);
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    result.push(formatInline(line));
  }

  if (inCodeBlock) {
    const code = escapeHtml(codeBlockLines.join("\n"));
    result.push(`<pre>${code}</pre>`);
  }

  return result.join("\n");
}

function formatInline(line: string): string {
  let result = escapeHtml(line);

  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/(?<!\w)__(.+?)__(?!\w)/g, "<b>$1</b>");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<i>$1</i>");
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  return result;
}

export function formatStreamForTelegram(text: string): string {
  const cleaned = stripAnsi(text);
  return `<pre>${escapeHtml(cleaned)}</pre>`;
}
