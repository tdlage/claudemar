import TurndownService from "turndown";
import { detectLanguage } from "./text.js";

export const MAX_EVENT_CHARS = 20_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.remove(["style", "script", "head", "title"]);

export function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html);
  } catch {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }
}

const QUOTE_INTRO_RES = [
  /^on .{4,120} wrote:\s*$/i,
  /^em .{4,120} escreveu:\s*$/i,
  /^el .{4,120} escribi[óo]:\s*$/i,
  /^-{3,}\s*(original message|mensagem original|mensaje original)\s*-{3,}$/i,
  /^_{5,}\s*$/,
];

const QUOTE_HEADER_BLOCK_RE = /^(de|from|para|to|enviado|sent|enviada em|assunto|subject|cc|data|date|fecha):\s/i;

export function stripQuotes(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let cut = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (QUOTE_INTRO_RES.some((re) => re.test(trimmed))) {
      cut = true;
      break;
    }
    if (trimmed.startsWith(">")) continue;
    if (QUOTE_HEADER_BLOCK_RE.test(trimmed)) {
      const next = lines.slice(i, i + 4).map((l) => l.trim());
      const headerLines = next.filter((l) => QUOTE_HEADER_BLOCK_RE.test(l)).length;
      if (headerLines >= 2) {
        cut = true;
        break;
      }
    }
    kept.push(line);
  }
  const result = kept.join("\n");
  if (!result.trim()) return text;
  return cut || kept.length < lines.length ? result.trimEnd() : result;
}

const SIGNATURE_MARKERS = [/^--\s*$/, /^—\s*$/, /^__+\s*$/];
const SIGNATURE_INTRO_RE =
  /^(atenciosamente|att\.?|abraços?|abs|cordialmente|saludos( cordiales)?|un saludo|atentamente|best regards|kind regards|regards|cheers|sincerely)[,.!]?\s*$/i;

const SIGNATURE_TAIL_LINES = 8;

export function stripSignature(text: string): string {
  const lines = text.split("\n");
  const from = Math.max(1, lines.length - SIGNATURE_TAIL_LINES);
  for (let i = from; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (SIGNATURE_MARKERS.some((re) => re.test(trimmed)) || SIGNATURE_INTRO_RE.test(trimmed)) {
      const cut = lines.slice(0, i).join("\n").trimEnd();
      return cut.trim() ? cut : text;
    }
  }
  return text;
}

export interface NormalizedMessage {
  text: string;
  lang: "pt" | "es" | "en";
  truncated: boolean;
}

export function normalizeMessage(bodyText: string, bodyHtml?: string): NormalizedMessage {
  let text = bodyText.trim().length > 0 ? bodyText : bodyHtml ? htmlToMarkdown(bodyHtml) : "";
  text = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  text = stripQuotes(text);
  text = stripSignature(text);
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  let truncated = false;
  if (text.length > MAX_EVENT_CHARS) {
    text = text.slice(0, MAX_EVENT_CHARS);
    truncated = true;
  }
  return { text, lang: detectLanguage(text), truncated };
}
