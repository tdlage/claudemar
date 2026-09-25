import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { config } from "./config.js";

const secret = process.env.UPLOAD_SIGN_SECRET || randomBytes(32).toString("hex");
const DEFAULT_TTL_SECONDS = 3600;
export const PR_EVIDENCE_TTL_SECONDS = 10 * 365 * 24 * 3600;
export const EVIDENCE_DIR = resolve(config.dataPath, "pipeline-evidence");
export const EVIDENCE_ROUTE = "/files/pipeline";
/** Caminho usado nos links de evidência já publicados em PRs antes da remoção do tracker. */
export const LEGACY_EVIDENCE_ROUTE = "/files/tracker";
export const EVIDENCE_FILE_PREFIX = "pipeline-";

export function signUploadUrl(filename: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret).update(`${filename}:${exp}`).digest("base64url");
  return `${EVIDENCE_ROUTE}/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
}

export function absoluteSignedUrl(filename: string, baseUrl: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  return `${baseUrl.replace(/\/+$/, "")}${signUploadUrl(filename, ttlSeconds)}`;
}

export function verifyUploadSignature(filename: string, exp: string, sig: string): boolean {
  const expNum = Number(exp);
  if (!expNum || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret).update(`${filename}:${expNum}`).digest("base64url");
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
