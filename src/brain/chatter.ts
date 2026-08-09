import { normalizeForIndex } from "./text.js";

export interface ChatterVerdict {
  chatter: boolean;
  rule: string | null;
}

const CONFIRMATIONS = new Set([
  "ok",
  "okay",
  "okey",
  "oks",
  "valeu",
  "vlw",
  "blz",
  "beleza",
  "combinado",
  "perfeito",
  "perfecto",
  "gracias",
  "vale",
  "thanks",
  "thank you",
  "thx",
  "deu certo",
  "entendido",
  "entendi",
  "certo",
  "show",
  "top",
  "joia",
  "obrigado",
  "obrigada",
  "de nada",
  "bom dia",
  "boa tarde",
  "boa noite",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "good morning",
  "sim",
  "nao",
  "si",
  "no",
  "yes",
  "dale",
  "feito",
  "done",
  "kk",
  "kkk",
  "kkkk",
  "haha",
  "rs",
  "rsrs",
]);

const FORWARD_HEADER_RE =
  /^(-{2,}\s*(forwarded message|mensagem encaminhada|mensaje reenviado|original message)\s*-{2,}|fwd?:|enc:|rv:)/i;

const AUTO_FOOTER_RE =
  /^(enviado do meu|sent from my|enviado desde mi|get outlook for|baixe o outlook|este e-?mail (foi|e) (enviado|gerado) automaticamente|this (is an automated|email was sent automatically)|nao responda (a )?este e-?mail|do not reply to this email|no responda a este correo)/i;

function stripEmojiAndSymbols(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{P}\p{S}\p{Z}\p{C}\p{Sk}\p{M}]/gu, "");
}

export function classifyChatter(
  text: string,
  opts: { minChars: number; extraConfirmations: string[] },
): ChatterVerdict {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { chatter: true, rule: "empty" };

  const substantive = stripEmojiAndSymbols(trimmed);
  if (substantive.length === 0) return { chatter: true, rule: "no_alnum" };

  const normalized = normalizeForIndex(trimmed).replace(/[!?.…,;:]+$/g, "").trim();
  if (CONFIRMATIONS.has(normalized)) return { chatter: true, rule: "confirmation" };
  for (const extra of opts.extraConfirmations) {
    if (normalized === normalizeForIndex(extra)) return { chatter: true, rule: "confirmation_extra" };
  }

  if (trimmed.length < opts.minChars) return { chatter: true, rule: "min_chars" };

  const firstLine = trimmed.split("\n", 1)[0].trim();
  if (FORWARD_HEADER_RE.test(firstLine) && trimmed.split("\n").length <= 2) {
    return { chatter: true, rule: "forward_header" };
  }
  if (AUTO_FOOTER_RE.test(normalized)) return { chatter: true, rule: "auto_footer" };

  return { chatter: false, rule: null };
}
