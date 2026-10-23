import type { Requester } from "./requester.js";

export const EMAIL_AUDIENCES = ["all", "admin", "user"] as const;
export type EmailAudience = (typeof EMAIL_AUDIENCES)[number];

export interface EmailProfile {
  name: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  region: string;
  from: string;
  senderName: string;
  audience: EmailAudience;
  userId: string;
}

const PROFILE_NAME = /^[^[\]\s]+$/;
const EMAIL_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function isEmailAudience(value: unknown): value is EmailAudience {
  return typeof value === "string" && (EMAIL_AUDIENCES as readonly string[]).includes(value);
}

// Perfis sem `audience` (anteriores ao controle de acesso) ficam restritos ao admin.
export function parseCredentials(raw: string): EmailProfile[] {
  const profiles: EmailProfile[] = [];
  let current: EmailProfile | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current) profiles.push(current);
      current = { name: sectionMatch[1], awsAccessKeyId: "", awsSecretAccessKey: "", region: "", from: "", senderName: "", audience: "admin", userId: "" };
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
    else if (key === "audience" && isEmailAudience(value)) current.audience = value;
    else if (key === "user_id") current.userId = value;
  }
  if (current) profiles.push(current);
  return profiles.map((p) => (p.audience === "user" ? p : { ...p, userId: "" }));
}

export function serializeCredentials(profiles: EmailProfile[]): string {
  return profiles
    .map((p) => {
      const lines = [
        `[${p.name}]`,
        `aws_access_key_id=${p.awsAccessKeyId}`,
        `aws_secret_access_key=${p.awsSecretAccessKey}`,
        `region=${p.region}`,
        `from=${p.from}`,
      ];
      if (p.senderName) lines.push(`sender_name=${p.senderName}`);
      lines.push(`audience=${p.audience}`);
      if (p.audience === "user") lines.push(`user_id=${p.userId}`);
      return lines.join("\n");
    })
    .join("\n\n") + "\n";
}

export function profileError(profile: EmailProfile): string | null {
  if (!PROFILE_NAME.test(profile.name)) return "Invalid profile name";
  const values = [profile.awsAccessKeyId, profile.awsSecretAccessKey, profile.region, profile.from, profile.senderName, profile.userId];
  if (values.some((value) => /[\r\n]/.test(value))) return "Profile fields cannot contain line breaks";
  if (!profile.awsAccessKeyId || !profile.awsSecretAccessKey || !profile.region) return "AWS access key, secret key and region are required";
  if (!EMAIL_ADDRESS.test(profile.from)) return "Invalid from address";
  if (!isEmailAudience(profile.audience)) return "audience must be one of: all, admin, user";
  if (profile.audience === "user" && !profile.userId) return "Select the user for this sender";
  return null;
}

export function profilesForRequester(profiles: EmailProfile[], requester: Requester): EmailProfile[] {
  return profiles.filter((p) => {
    if (p.audience === "all") return true;
    if (requester.role === "admin") return p.audience === "admin";
    return p.audience === "user" && requester.userId !== null && p.userId === requester.userId;
  });
}

export function findSender(senders: EmailProfile[], from: string): EmailProfile | undefined {
  const wanted = from.trim().toLowerCase();
  return senders.find((p) => p.from.toLowerCase() === wanted);
}

export function defaultSender(senders: EmailProfile[], configuredDefault: string): EmailProfile | undefined {
  if (configuredDefault) {
    const configured = findSender(senders, configuredDefault);
    if (configured) return configured;
  }
  return senders.length === 1 ? senders[0] : undefined;
}

export function formatSender(profile: EmailProfile): string {
  return profile.senderName ? `${profile.senderName} <${profile.from}>` : profile.from;
}
