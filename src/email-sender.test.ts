import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { attachmentOutsideRoots, sendEmail } from "./email-sender.js";
import type { EmailProfile } from "./email-profiles.js";

const base = mkdtempSync(resolve(tmpdir(), "claudemar-email-sender-"));
const workspace = resolve(base, "agents/ana");
const other = resolve(base, "agents/bruno");
mkdirSync(resolve(workspace, "output"), { recursive: true });
mkdirSync(other, { recursive: true });
const report = resolve(workspace, "output/relatorio.pdf");
const secret = resolve(other, "secrets.json");
const link = resolve(workspace, "output/atalho.json");
writeFileSync(report, "pdf");
writeFileSync(secret, "{}");
symlinkSync(secret, link);

after(() => rmSync(base, { recursive: true, force: true }));

const profile: EmailProfile = {
  name: "ana", awsAccessKeyId: "AKIA", awsSecretAccessKey: "s", region: "us-east-1",
  from: "ana@claudemar.dev", senderName: "", audience: "user", userId: "u-ana",
};

test("anexos dentro do workspace passam; fora dele, inclusive via symlink, são barrados", () => {
  assert.equal(attachmentOutsideRoots([report], [workspace]), undefined);
  assert.equal(attachmentOutsideRoots([secret], [workspace]), secret);
  assert.equal(attachmentOutsideRoots([link], [workspace]), link);
  assert.equal(attachmentOutsideRoots([workspace], [workspace]), workspace);
  assert.equal(attachmentOutsideRoots([secret], [workspace, other]), undefined);
});

test("limite de 40 MB considera o tamanho depois da codificação base64", async () => {
  const big = resolve(workspace, "output/grande.bin");
  writeFileSync(big, Buffer.alloc(31_000_000));
  await assert.rejects(
    sendEmail(profile, { to: ["x@y.com"], subject: "s", body: "b", attachments: [big] }),
    /40 MB/,
  );
});
