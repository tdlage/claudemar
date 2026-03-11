import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secret = process.env.UPLOAD_SIGN_SECRET || randomBytes(32).toString("hex");
const DEFAULT_TTL_SECONDS = 3600;

export function signUploadUrl(filename: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret).update(`${filename}:${exp}`).digest("base64url");
  return `/files/tracker/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
}

export function verifyUploadSignature(filename: string, exp: string, sig: string): boolean {
  const expNum = Number(exp);
  if (!expNum || expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret).update(`${filename}:${expNum}`).digest("base64url");
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
