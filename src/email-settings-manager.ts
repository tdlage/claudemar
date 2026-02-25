import { execFileSync, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { getCredentialsPath, getEmailScriptPath, isEmailEnabled } from "./email-init.js";

export interface EmailProfile {
  name: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region: string;
  from: string;
  senderName: string;
}

export interface EmailProfileMasked {
  name: string;
  awsAccessKeyId: string;
  awsSecretAccessKeyMasked: string;
  region: string;
  from: string;
  senderName: string;
}

function maskKey(value: string): string {
  if (value.length < 8) return "****";
  return "****" + value.slice(-4);
}

function parseCredentials(raw: string): EmailProfile[] {
  const profiles: EmailProfile[] = [];
  let current: Partial<EmailProfile> | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current?.name) profiles.push(current as EmailProfile);
      current = { name: sectionMatch[1], awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "", senderName: "" };
      continue;
    }
    if (!current) continue;
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    if (key === "aws_access_key_id") current.awsAccessKeyId = value;
    else if (key === "aws_secret_access_key") current.awsSecretAccessKey = value;
    else if (key === "region") current.region = value;
    else if (key === "from") current.from = value;
    else if (key === "sender_name") current.senderName = value;
  }
  if (current?.name) profiles.push(current as EmailProfile);
  return profiles;
}

function serializeCredentials(profiles: EmailProfile[]): string {
  return profiles
    .map((p) => {
      let lines = `[${p.name}]\naws_access_key_id=${p.awsAccessKeyId}\naws_secret_access_key=${p.awsSecretAccessKey}\nregion=${p.region}\nfrom=${p.from}`;
      if (p.senderName) lines += `\nsender_name=${p.senderName}`;
      return lines;
    })
    .join("\n\n") + "\n";
}

function sudoRead(): string {
  try {
    return execFileSync("sudo", ["cat", getCredentialsPath()], { timeout: 5000, encoding: "utf-8" });
  } catch {
    return "";
  }
}

function sudoWrite(content: string): void {
  const path = getCredentialsPath();
  execFileSync("sudo", ["tee", path], { input: content, timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
  execFileSync("sudo", ["chmod", "600", path], { timeout: 3000 });
  execFileSync("sudo", ["chown", "root:root", path], { timeout: 3000 });
}

function sudoDelete(): void {
  try {
    execFileSync("sudo", ["rm", "-f", getCredentialsPath()], { timeout: 5000 });
  } catch {
  }
}

function loadProfiles(): EmailProfile[] {
  if (!isEmailEnabled()) return [];
  const raw = sudoRead();
  if (!raw) return [];
  return parseCredentials(raw);
}

function saveProfiles(profiles: EmailProfile[]): void {
  sudoWrite(serializeCredentials(profiles));
}

function toMasked(p: EmailProfile): EmailProfileMasked {
  return {
    name: p.name,
    awsAccessKeyId: p.awsAccessKeyId,
    awsSecretAccessKeyMasked: maskKey(p.awsSecretAccessKey),
    region: p.region,
    from: p.from,
    senderName: p.senderName,
  };
}

class EmailSettingsManager {
  getProfiles(): EmailProfileMasked[] {
    return loadProfiles().map(toMasked);
  }

  createProfile(profile: EmailProfile): EmailProfileMasked {
    const profiles = loadProfiles();
    if (profiles.some((p) => p.name === profile.name)) {
      throw new Error(`Profile '${profile.name}' already exists`);
    }
    profiles.push(profile);
    saveProfiles(profiles);
    return toMasked(profile);
  }

  updateProfile(name: string, updates: Partial<EmailProfile>): EmailProfileMasked | null {
    const profiles = loadProfiles();
    const idx = profiles.findIndex((p) => p.name === name);
    if (idx === -1) return null;
    const existing = profiles[idx];
    const updated: EmailProfile = {
      name: updates.name ?? existing.name,
      awsAccessKeyId: updates.awsAccessKeyId ?? existing.awsAccessKeyId,
      awsSecretAccessKey: updates.awsSecretAccessKey && updates.awsSecretAccessKey !== ""
        ? updates.awsSecretAccessKey
        : existing.awsSecretAccessKey,
      region: updates.region ?? existing.region,
      from: updates.from ?? existing.from,
      senderName: updates.senderName ?? existing.senderName,
    };
    profiles[idx] = updated;
    saveProfiles(profiles);
    return toMasked(updated);
  }

  deleteProfile(name: string): boolean {
    const profiles = loadProfiles();
    const filtered = profiles.filter((p) => p.name !== name);
    if (filtered.length === profiles.length) return false;
    if (filtered.length === 0) {
      sudoDelete();
    } else {
      saveProfiles(filtered);
    }
    return true;
  }

  testProfile(name: string, to: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const scriptPath = getEmailScriptPath();
      if (!existsSync(scriptPath)) {
        reject(new Error("Email script not found. Restart the server to regenerate it."));
        return;
      }
      const profiles = loadProfiles();
      const profile = profiles.find((p) => p.name === name);
      if (!profile) {
        reject(new Error(`Profile '${name}' not found`));
        return;
      }
      const args = [
        "--to", to,
        "--subject", "Claudemar email test",
        "--body", `Test email from profile [${name}] at ${new Date().toISOString()}`,
        "--from", profile.from,
      ];
      execFile(
        scriptPath,
        args,
        { timeout: 15000 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout.trim());
        },
      );
    });
  }
}

export const emailSettingsManager = new EmailSettingsManager();
