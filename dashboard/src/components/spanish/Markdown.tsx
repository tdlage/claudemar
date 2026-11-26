import { useMemo } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";

const markdown = new Marked({ gfm: true, breaks: true });

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(markdown.parse(text, { async: false })), [text]);
  return <div className={`espanol-markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
