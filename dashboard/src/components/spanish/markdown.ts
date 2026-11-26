import { Marked } from "marked";
import DOMPurify from "dompurify";

const markdown = new Marked({ gfm: true, breaks: true });

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(markdown.parse(text, { async: false }));
}
