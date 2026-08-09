import { createHash } from "node:crypto";

export function normalizeForIndex(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text: string, maxLen = 40): string {
  const slug = normalizeForIndex(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || "sem-assunto";
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hash8(threadKey: string): string {
  return sha256Hex(threadKey).slice(0, 8);
}

const LANG_MARKERS: Record<string, string[]> = {
  pt: ["não", "você", "está", "para", "com", "uma", "isso", "obrigado", "já", "então", "também", "amanhã"],
  es: ["usted", "está", "para", "con", "una", "eso", "gracias", "mañana", "aquí", "pero", "hasta", "señor"],
  en: ["the", "you", "are", "for", "with", "this", "thanks", "tomorrow", "here", "but", "that", "please"],
};

export function detectLanguage(text: string): "pt" | "es" | "en" {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter(Boolean),
  );
  let best: "pt" | "es" | "en" = "pt";
  let bestScore = -1;
  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    const score = markers.reduce((acc, m) => acc + (words.has(m) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = lang as "pt" | "es" | "en";
    }
  }
  return best;
}

export function dateInTz(date: Date, tz: string): { yyyy: string; mm: string; dd: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return { yyyy: get("year"), mm: get("month"), dd: get("day") };
}

export function dayKeyInTz(date: Date, tz: string): string {
  const { yyyy, mm, dd } = dateInTz(date, tz);
  return `${yyyy}-${mm}-${dd}`;
}

export function isoWeekKey(date: Date, tz: string): string {
  const { yyyy, mm, dd } = dateInTz(date, tz);
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
