import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(import.meta.dirname, "../../.output/agent-context-files");
mkdirSync(output, { recursive: true });
const data = mkdtempSync(resolve(output, "data-"));
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.ALLOWED_CHAT_ID = "1";
process.env.CLAUDEMAR_DATA = data;
process.env.BRAIN_ROOT = resolve(data, "brain");

const { buildContextFilesHint, contextFilesSignature, readContextTitle } = await import("../src/agents/agent-context.js");
const context = resolve(data, "agents/helper/context");

after(() => rmSync(data, { recursive: true, force: true }));

function write(relativePath: string, content: string) {
  const path = resolve(context, relativePath);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
  return path;
}

test("titles skip bare hashes, empty headings and fenced code", () => {
  assert.equal(readContextTitle(write("bare.md", "#\nTODO list\n## Real title\n")), "Real title");
  assert.equal(readContextTitle(write("empty.md", "## \n\nbody\n")), null);
  assert.equal(readContextTitle(write("fenced.md", "```bash\n# install deps\n```\n# Setup guide\n")), "Setup guide");
  assert.equal(readContextTitle(write("data.csv", "# not markdown\n")), null);
});

test("the hint lists files in subfolders and the signature ignores content edits", () => {
  write("clients/acme/brief.md", "# ACME brief\n");
  const hint = buildContextFilesHint("helper");
  assert.match(hint, /context\/clients\/acme\/brief\.md — "ACME brief"/);
  assert.match(hint, /including its subfolders/);
  const before = contextFilesSignature("helper");
  write("clients/acme/brief.md", "# ACME brief\nupdated body\n");
  assert.equal(contextFilesSignature("helper"), before);
  write("clients/acme/notes.md", "# Notes\n");
  assert.notEqual(contextFilesSignature("helper"), before);
});

test("large knowledge bases are capped in the prompt", () => {
  for (let i = 0; i < 210; i++) write(`bulk/file-${String(i).padStart(3, "0")}.txt`, "x");
  const hint = buildContextFilesHint("helper");
  assert.equal((hint.match(/^- \//gm) ?? []).length, 200);
  assert.match(hint, /… and \d+ more file\(s\); list them with: find /);
});
