import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const CREDENTIALS_DIR = "/etc/claudemar";
const CREDENTIALS_PATH = `${CREDENTIALS_DIR}/.email-credentials`;
const LEGACY_CREDENTIALS_FILE = ".email-credentials";
const LEGACY_SEND_EMAIL_SCRIPT = "send-email.sh";

export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}

export function isEmailEnabled(): boolean {
  try {
    execFileSync("sudo", ["test", "-f", CREDENTIALS_PATH], { timeout: 3000, stdio: "pipe" });
    return true;
  } catch (err) {
    console.error("[email] isEmailEnabled check failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export function ensureCredentialsDir(): void {
  try {
    execFileSync("sudo", ["mkdir", "-p", CREDENTIALS_DIR], { timeout: 5000 });
    execFileSync("sudo", ["chmod", "700", CREDENTIALS_DIR], { timeout: 3000 });
    execFileSync("sudo", ["chown", "root:root", CREDENTIALS_DIR], { timeout: 3000 });
  } catch (err) {
    console.error("[email] Failed to create credentials directory:", err);
  }

  if (!isEmailEnabled()) {
    const legacyPaths = [
      resolve(config.basePath, LEGACY_CREDENTIALS_FILE),
      resolve(config.installDir, LEGACY_CREDENTIALS_FILE),
    ];
    const legacyPath = legacyPaths.find((p) => existsSync(p));
    if (legacyPath) {
      try {
        execFileSync("sudo", ["mv", legacyPath, CREDENTIALS_PATH], { timeout: 5000 });
        execFileSync("sudo", ["chmod", "600", CREDENTIALS_PATH], { timeout: 3000 });
        execFileSync("sudo", ["chown", "root:root", CREDENTIALS_PATH], { timeout: 3000 });
        console.log(`[email] Migrated ${legacyPath} → ${CREDENTIALS_PATH}`);
      } catch (err) {
        console.error("[email] Failed to migrate credentials:", err);
      }
    }
  }
}

export function removeLegacySendEmailScript(): void {
  for (const path of [resolve(config.basePath, LEGACY_SEND_EMAIL_SCRIPT), resolve(config.installDir, LEGACY_SEND_EMAIL_SCRIPT)]) {
    if (!existsSync(path)) continue;
    rmSync(path, { force: true });
    console.log(`[email] Removed legacy ${path}`);
  }
}
