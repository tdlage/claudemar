import { execFileSync } from "node:child_process";
import { getCredentialsPath, isEmailEnabled } from "./email-init.js";
import { sendEmail } from "./email-sender.js";
import { settingsManager } from "./settings-manager.js";
import { usersManager } from "./users-manager.js";
import { requesterKey, type Requester } from "./requester.js";
import {
  defaultSender,
  parseCredentials,
  profileError,
  profilesForRequester,
  serializeCredentials,
  type EmailAudience,
  type EmailProfile,
} from "./email-profiles.js";

export interface EmailProfileMasked {
  name: string;
  awsAccessKeyId: string;
  awsSecretAccessKeyMasked: string;
  region: string;
  from: string;
  senderName: string;
  audience: EmailAudience;
  userId: string;
}

export type EmailProfileInput = Partial<EmailProfile>;

export class EmailProfileError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

function maskKey(value: string): string {
  if (value.length < 8) return "****";
  return "****" + value.slice(-4);
}

function sudoRead(): string | null {
  try {
    return execFileSync("sudo", ["cat", getCredentialsPath()], { timeout: 5000, encoding: "utf-8" });
  } catch (err) {
    console.error("[email] Failed to read credentials:", err instanceof Error ? err.message : err);
    return null;
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

function readProfiles(): EmailProfile[] | null {
  if (!isEmailEnabled()) return [];
  const raw = sudoRead();
  return raw === null ? null : parseCredentials(raw);
}

function toMasked(p: EmailProfile): EmailProfileMasked {
  return {
    name: p.name,
    awsAccessKeyId: p.awsAccessKeyId,
    awsSecretAccessKeyMasked: maskKey(p.awsSecretAccessKey),
    region: p.region,
    from: p.from,
    senderName: p.senderName,
    audience: p.audience,
    userId: p.userId,
  };
}

function assertValid(profile: EmailProfile): void {
  const error = profileError(profile);
  if (error) throw new EmailProfileError(error, 400);
}

class EmailSettingsManager {
  private cache: EmailProfile[] | null = null;

  private profiles(): EmailProfile[] {
    if (this.cache) return this.cache;
    const loaded = readProfiles();
    if (loaded) this.cache = loaded;
    return loaded ?? [];
  }

  private save(profiles: EmailProfile[]): void {
    if (profiles.length === 0) sudoDelete();
    else sudoWrite(serializeCredentials(profiles));
    this.cache = profiles;
  }

  getProfiles(): EmailProfileMasked[] {
    return this.profiles().map(toMasked);
  }

  sendersFor(requester: Requester): EmailProfile[] {
    return profilesForRequester(this.profiles(), requester);
  }

  defaultSenderOf(senders: EmailProfile[]): EmailProfile | undefined {
    return defaultSender(senders, settingsManager.get().sesFrom);
  }

  accessSignature(requester: Requester): string {
    const senders = this.sendersFor(requester);
    const fallback = this.defaultSenderOf(senders)?.from ?? "";
    return [requesterKey(requester), fallback, ...senders.map((s) => `${s.name}|${s.from}|${s.senderName}`)].join("\n");
  }

  createProfile(input: EmailProfile, credentialsFrom?: string): EmailProfileMasked {
    const profiles = this.profiles();
    if (profiles.some((p) => p.name === input.name)) {
      throw new EmailProfileError(`Profile '${input.name}' already exists`, 409);
    }
    let profile: EmailProfile = { ...input, userId: input.audience === "user" ? input.userId : "" };
    if (credentialsFrom) {
      const source = profiles.find((p) => p.name === credentialsFrom);
      if (!source) throw new EmailProfileError(`Profile '${credentialsFrom}' not found`, 400);
      profile = { ...profile, awsAccessKeyId: source.awsAccessKeyId, awsSecretAccessKey: source.awsSecretAccessKey, region: source.region };
    }
    assertValid(profile);
    if (profile.audience === "user" && !usersManager.get(profile.userId)) throw new EmailProfileError("User not found", 400);
    this.save([...profiles, profile]);
    return toMasked(profile);
  }

  // Valida o perfil resultante do merge: atualizações parciais são aceitas e um usuário já
  // removido pode continuar atribuído enquanto a audiência não for alterada.
  updateProfile(name: string, updates: EmailProfileInput): EmailProfileMasked {
    const profiles = this.profiles();
    const existing = profiles.find((p) => p.name === name);
    if (!existing) throw new EmailProfileError("Profile not found", 404);
    if (updates.name && updates.name !== name && profiles.some((p) => p.name === updates.name)) {
      throw new EmailProfileError(`Profile '${updates.name}' already exists`, 409);
    }
    const audience = updates.audience ?? existing.audience;
    const updated: EmailProfile = {
      name: updates.name ?? existing.name,
      awsAccessKeyId: updates.awsAccessKeyId ?? existing.awsAccessKeyId,
      awsSecretAccessKey: updates.awsSecretAccessKey || existing.awsSecretAccessKey,
      region: updates.region ?? existing.region,
      from: updates.from ?? existing.from,
      senderName: updates.senderName ?? existing.senderName,
      audience,
      userId: audience === "user" ? updates.userId ?? existing.userId : "",
    };
    assertValid(updated);
    const userChanged = updated.audience === "user" && (existing.audience !== "user" || existing.userId !== updated.userId);
    if (userChanged && !usersManager.get(updated.userId)) throw new EmailProfileError("User not found", 400);
    this.save(profiles.map((p) => (p === existing ? updated : p)));
    return toMasked(updated);
  }

  deleteProfile(name: string): boolean {
    const profiles = this.profiles();
    const remaining = profiles.filter((p) => p.name !== name);
    if (remaining.length === profiles.length) return false;
    this.save(remaining);
    return true;
  }

  async testProfile(name: string, to: string): Promise<string> {
    const profile = this.profiles().find((p) => p.name === name);
    if (!profile) throw new EmailProfileError(`Profile '${name}' not found`, 404);
    const messageId = await sendEmail(profile, {
      to: [to],
      subject: "Claudemar email test",
      body: `Test email from profile [${name}] at ${new Date().toISOString()}`,
    });
    return `Email sent from ${profile.from} to ${to} (MessageId ${messageId})`;
  }
}

export const emailSettingsManager = new EmailSettingsManager();
