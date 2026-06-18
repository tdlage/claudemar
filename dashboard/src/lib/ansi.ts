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
  const plain = stripAnsi(text);
  const raw = markedInstance.parse(plain) as string;
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ["data-md-path"] });
  return linkifyMdPaths(clean);
}
