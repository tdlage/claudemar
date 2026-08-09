import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import { attachmentsDir } from "./paths.js";
import { sha256Hex } from "./text.js";
import type { StoredAttachment } from "./types.js";

let s3: S3Client | null = null;

function r2Enabled(): boolean {
  return Boolean(config.r2Endpoint && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2BucketAttachments);
}

function getS3(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: "auto",
      endpoint: config.r2Endpoint,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }
  return s3;
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
  return cleaned || "arquivo";
}

async function store(buf: Buffer, key: string): Promise<string> {
  if (r2Enabled()) {
    await getS3().send(
      new PutObjectCommand({ Bucket: config.r2BucketAttachments, Key: key, Body: buf }),
    );
    return `r2://${config.r2BucketAttachments}/${key}`;
  }
  const localPath = resolve(attachmentsDir, key);
  if (!existsSync(localPath)) {
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buf);
  }
  return `file://${localPath}`;
}

export async function storeAttachment(buf: Buffer, name: string): Promise<StoredAttachment> {
  const sha256 = sha256Hex(buf);
  const key = `${sha256.slice(0, 2)}/${sha256}--${safeName(name)}`;
  const uri = await store(buf, key);
  return { name, bytes: buf.length, sha256, uri };
}

export async function storeOriginal(content: Buffer | string, threadKey: string, kind: string): Promise<string> {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  const sha256 = sha256Hex(buf);
  const key = `originals/${sha256.slice(0, 2)}/${sha256}--${safeName(threadKey)}.${kind}`;
  return store(buf, key);
}
