import type { RowDataPacket } from "mysql2/promise";
import { query } from "../../database.js";
import { tokenManager } from "../../server/token-manager.js";
import { usersManager } from "../../users-manager.js";

export const REDACTED = "[segredo omitido]";

const SECRET_NAME_RE = /(KEY|TOKEN|SECRET|PASS|CREDENTIAL|AUTH|SENHA|PRIVATE)/i;
const MIN_SECRET_LENGTH = 8;
const MAX_REDACT_CHARS = 400_000;

/** Todos os quantificadores são limitados: o texto vem de terceiros e roda no processo principal. */
const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,2000}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,200}/g,
  /\bsk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{20,500}/g,
  /\b(?:xai|gsk|glpat|dckr_pat|npm|hf|ghp|gho|ghu|ghs|ghr|github_pat|xox[abposr]|xapp)[-_][A-Za-z0-9_-]{16,500}/g,
  /\bGOCSPX-[A-Za-z0-9_-]{10,200}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bya29\.[0-9A-Za-z_-]{20,2000}/g,
  /\b1\/\/0[0-9A-Za-z_-]{20,500}/g,
  /\beyJ[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{10,1000}/g,
  /\bcmb_[A-Za-z0-9_-]{20,200}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
];

const URL_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:/@"'`]{0,200}):([^\s/@"'`]{1,300})@/gi;
const CLI_PASSWORD_RE = /(\s(?:-p|--password[= ]|--pass[= ]|--token[= ]|-u\s{1,5}[^\s:]{1,100}:)|\bsshpass\s{1,5}-p\s{1,5}|\bredis-cli\b[^\n]{0,200}?\s-a\s{1,5})(["']?)([^\s"'`]{4,300})/g;
const ASSIGNMENT_RE = /(["']?)([A-Za-z][A-Za-z0-9_.-]{0,80})\1(\s{0,5}[=:]\s{0,5})(["']?)([^\s"'`,;{}()]{1,500})/g;
const SPACED_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]{0,60}(?:password|passwd|senha|secret|token|key))\s{1,5}([^\s"'`]{16,300})/gi;
const PEM_BEGIN_RE = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_END_RE = /-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;

function looksSecret(value: string): boolean {
  if (value.length < MIN_SECRET_LENGTH || value.startsWith("$") || value.startsWith("[segredo")) return false;
  if (/^(process\.env|os\.environ|getenv|true|false|null|undefined)/i.test(value)) return false;
  return !/^\d+$/.test(value);
}

function redactPrivateKeys(text: string): string {
  let out = "";
  let cursor = 0;
  PEM_BEGIN_RE.lastIndex = 0;
  for (let begin = PEM_BEGIN_RE.exec(text); begin; begin = PEM_BEGIN_RE.exec(text)) {
    PEM_END_RE.lastIndex = begin.index;
    const end = PEM_END_RE.exec(text);
    const stop = end ? end.index + end[0].length : text.length;
    out += `${text.slice(cursor, begin.index)}${REDACTED}`;
    cursor = stop;
    PEM_BEGIN_RE.lastIndex = stop;
  }
  return out + text.slice(cursor);
}

function clipForRedaction(text: string): string {
  if (text.length <= MAX_REDACT_CHARS) return text;
  const half = MAX_REDACT_CHARS / 2;
  const headEnd = text.lastIndexOf(" ", half);
  const tailStart = text.indexOf(" ", text.length - half);
  return `${text.slice(0, headEnd > 0 ? headEnd : half)}\n[… ${text.length - MAX_REDACT_CHARS} caracteres omitidos …]\n${text.slice(tailStart > 0 ? tailStart : text.length - half)}`;
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = clipForRedaction(text);
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  out = redactPrivateKeys(out);
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(URL_CREDENTIALS_RE, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`);
  out = out.replace(CLI_PASSWORD_RE, (match, flag: string, quote: string, value: string) =>
    value.startsWith("[segredo") ? match : `${flag}${quote}${REDACTED}`,
  );
  out = out.replace(ASSIGNMENT_RE, (match, q1: string, name: string, sep: string, q2: string, value: string) =>
    SECRET_NAME_RE.test(name) && looksSecret(value) ? `${q1}${name}${q1}${sep}${q2}${REDACTED}` : match,
  );
  return out.replace(SPACED_ASSIGNMENT_RE, (match, name: string, value: string) =>
    /\d/.test(value) && /[A-Za-z]/.test(value) && looksSecret(value) ? `${name} ${REDACTED}` : match,
  );
}

function envSecretValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
    if (SECRET_NAME_RE.test(name)) values.push(value);
    for (const match of value.matchAll(/:\/\/[^\s:/@]*:([^\s/@]{4,300})@/g)) values.push(match[1]);
  }
  return values;
}

function platformTokens(): string[] {
  return [...tokenManager.getActiveTokens(), ...usersManager.getAll().map((u) => u.token)];
}

async function agentSecretValues(): Promise<string[]> {
  const rows = await query<(RowDataPacket & { value: string })[]>("SELECT value FROM agent_secrets");
  return rows.map((row) => row.value);
}

/** Valores exatos dos segredos vigentes, lidos a cada uso para não perder um segredo recém-criado ou rotacionado. */
export async function knownSecretValues(): Promise<string[]> {
  const values = [...envSecretValues(), ...platformTokens(), ...(await agentSecretValues())];
  return [...new Set(values.filter((v) => typeof v === "string" && v.length >= MIN_SECRET_LENGTH))].sort(
    (a, b) => b.length - a.length,
  );
}

export type Redactor = (text: string) => string;

export async function createRedactor(): Promise<Redactor> {
  const secrets = await knownSecretValues();
  return (text) => redactSecrets(text, secrets);
}

/** Redige todas as strings de uma estrutura antes de qualquer truncamento, que partiria um segredo e o deixaria passar. */
export function redactDeep<T>(value: T, redact: Redactor): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactDeep(item, redact)]),
    ) as T;
  }
  return value;
}

const PII_PATTERNS: [RegExp, string][] = [
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[cpf]"],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[cnpj]"],
  [/\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}\b/g, "[email]"],
  [/(?:\+?\d{2}\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]"],
];

/** Para trechos exibidos em páginas sem marcação de PII: esconde documentos e contatos de terceiros. */
export function maskPersonalData(text: string): string {
  return PII_PATTERNS.reduce((out, [pattern, label]) => out.replace(pattern, label), text);
}
