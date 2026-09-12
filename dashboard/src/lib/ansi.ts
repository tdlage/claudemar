import { Marked } from "marked";
import DOMPurify from "dompurify";

const MD_PATH_RE = /(?:^|(?<=[\s`'"(>]))([.\/~]?[\w./_-]*\/[\w._-]+\.md|[\w._-]+\.md)(?=[\s`'")\],:;<>]|&lt;|&gt;|&amp;|$)/gm;
const MD_PATH_PLAIN_RE = /(?:^|(?<=[\s`'"(]))([.\/~]?[\w./_-]*\/[\w._-]+\.md|[\w._-]+\.md)(?=[\s`'")\],:;]|$)/gm;

export function linkifyMdPaths(html: string): string {
  return html.replace(MD_PATH_RE, (match) => {
    return `<a data-md-path="${match}" class="md-link" style="color:#818cf8;text-decoration:underline;text-underline-offset:2px;cursor:pointer">${match}</a>`;
  });
}

export function extractMdPaths(text: string): string[] {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  const matches = plain.match(MD_PATH_PLAIN_RE);
  if (!matches) return [];
  return [...new Set(matches)];
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const markedInstance = new Marked({
  breaks: true,
  gfm: true,
});

export function renderOutputHtml(text: string): string {
  const toolPattern = /\x1b\[36m\x1b\[1m> [^\r\n]*?\x1b\[0m [\s\S]*?\x1b\[0m(?:\r?\n|$)/g;
  const parts: string[] = [];
  let offset = 0;
  for (const match of text.matchAll(toolPattern)) {
    parts.push(markedInstance.parse(stripAnsi(text.slice(offset, match.index))) as string);
    const tool = stripAnsi(match[0]).replace(/^> /, "").trimEnd();
    const escaped = tool.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    parts.push(`<blockquote><p>${escaped.replace(/\r?\n/g, "<br>")}</p></blockquote>`);
    offset = match.index + match[0].length;
  }
  parts.push(markedInstance.parse(stripAnsi(text.slice(offset))) as string);
  const raw = parts.join("");
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["data-md-path"] });
  return linkifyMdPaths(clean);
}
