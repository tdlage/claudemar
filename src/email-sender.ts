import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative } from "node:path";
import { SESv2Client, SendEmailCommand, type Attachment } from "@aws-sdk/client-sesv2";
import { lookup as lookupMimeType } from "mime-types";
import type { EmailProfile } from "./email-profiles.js";

const MAX_MESSAGE_BYTES = 40_000_000;

export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: boolean;
  attachments?: string[];
}

function fromAddress(profile: EmailProfile): string {
  if (!profile.senderName) return profile.from;
  const name = /^[\x20-\x7e]*$/.test(profile.senderName)
    ? `"${profile.senderName.replace(/["\\]/g, "\\$&")}"`
    : `=?UTF-8?B?${Buffer.from(profile.senderName, "utf-8").toString("base64")}?=`;
  return `${name} <${profile.from}>`;
}

function attachmentSize(path: string): number {
  if (!isAbsolute(path)) throw new Error(`O anexo precisa de caminho absoluto: ${path}`);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats?.isFile()) throw new Error(`Anexo não encontrado: ${path}`);
  return stats.size;
}

// Base64 em linhas MIME de 76 caracteres + CRLF.
function base64MimeSize(bytes: number): number {
  return Math.ceil((Math.ceil(bytes / 3) * 4 * 78) / 76);
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function attachmentOutsideRoots(paths: string[], roots: string[]): string | undefined {
  const realRoots = roots.filter((root) => existsSync(root)).map((root) => realpathSync(root));
  return paths.find((path) => {
    if (!isAbsolute(path) || !existsSync(path)) return false;
    const real = realpathSync(path);
    return !realRoots.some((root) => isInside(real, root));
  });
}

function loadAttachments(email: OutgoingEmail, paths: string[]): Attachment[] {
  const textBytes = Buffer.byteLength(email.subject) + Buffer.byteLength(email.body);
  const total = paths.reduce((sum, path) => sum + base64MimeSize(attachmentSize(path)), textBytes);
  if (total > MAX_MESSAGE_BYTES) throw new Error("O email excede o limite de 40 MB do SES (os anexos ocupam cerca de 1/3 a mais depois de codificados em base64)");
  return paths.map((path) => ({
    FileName: basename(path),
    RawContent: readFileSync(path),
    ContentType: lookupMimeType(path) || "application/octet-stream",
    ContentDisposition: "ATTACHMENT",
    ContentTransferEncoding: "BASE64",
  }));
}

export async function sendEmail(profile: EmailProfile, email: OutgoingEmail): Promise<string> {
  const attachments = email.attachments?.length ? loadAttachments(email, email.attachments) : undefined;
  const client = new SESv2Client({
    region: profile.region,
    credentials: { accessKeyId: profile.awsAccessKeyId, secretAccessKey: profile.awsSecretAccessKey },
  });
  try {
    const body = { Data: email.body, Charset: "UTF-8" };
    const result = await client.send(new SendEmailCommand({
      FromEmailAddress: fromAddress(profile),
      Destination: { ToAddresses: email.to, CcAddresses: email.cc?.length ? email.cc : undefined },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: email.html ? { Html: body } : { Text: body },
          Attachments: attachments,
        },
      },
    }));
    return result.MessageId ?? "";
  } finally {
    client.destroy();
  }
}
