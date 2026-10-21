import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { byteLimiter, formatSize, truncateUtf8 } from "../src/byte-utils.js";
import {
  applyMirror,
  FatalSyncError,
  linkDirectoryName,
  localFileName,
  MirrorAbortedError,
  planMirror,
  readManifest,
  uniqueName,
  writeManifest,
  type Manifest,
  type MirrorFile,
  type MirrorFolder,
  type MirrorOptions,
  type PlannedFile,
} from "../src/google-drive/mirror.js";
import { changeAffects, driveErrorInfo, FileTooLargeError, fileErrorMessage, isFileLevelError } from "../src/google-drive/drive-api.js";

const output = resolve(import.meta.dirname, "../../.output/google-drive-mirror-test");
await mkdir(output, { recursive: true });
const base = await mkdtemp(resolve(output, "run-"));
let workDir: string;
let root: string;
let downloads: string[];

after(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  workDir = await mkdtemp(resolve(base, "case-"));
  root = join(workDir, "Folder");
  downloads = [];
});

function file(id: string, name: string, overrides: Partial<MirrorFile> = {}): MirrorFile {
  return {
    id,
    sourceId: id,
    parentId: "root",
    name,
    extension: "",
    fingerprint: `md5:${id}-1`,
    revision: "1",
    size: null,
    mimeType: "text/plain",
    exportMimeType: null,
    createdTime: "2026-01-01T00:00:00.000Z",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    webViewLink: null,
    ...overrides,
  };
}

function folder(id: string, name: string, parentId = "root"): MirrorFolder {
  return { id, parentId, name, createdTime: "2026-01-01T00:00:00.000Z" };
}

const emptyManifest: Manifest = { files: [], skipped: [], signature: null };

async function contentDownload(planned: PlannedFile, destination: string): Promise<void> {
  downloads.push(planned.id);
  await writeFile(destination, `${planned.id}:${planned.fingerprint}`);
}

function options(plan: ReturnType<typeof planMirror>, previous: Manifest, overrides: Partial<MirrorOptions> = {}): MirrorOptions {
  return {
    root,
    workDir,
    key: "link-1",
    plan,
    previous,
    download: contentDownload,
    concurrency: 3,
    maxFileBytes: 0,
    maxTotalBytes: 0,
    ...overrides,
  };
}

async function sync(files: MirrorFile[], previous: Manifest, folders: MirrorFolder[] = [], overrides: Partial<MirrorOptions> = {}) {
  const result = await applyMirror(options(planMirror("root", folders, files), previous, overrides));
  return { ...result, manifest: { files: result.files, skipped: result.skipped, signature: result.signature } };
}

test("local names drop path separators and control characters", () => {
  assert.equal(localFileName("a/b\\c\u0001d"), "a_b_c_d");
  assert.equal(localFileName("   "), "untitled");
  assert.equal(localFileName(".."), "__");
  assert.equal(localFileName("."), "_");
  assert.equal(localFileName(".env"), ".env");
});

test("exported Google files get the export extension once", () => {
  assert.equal(localFileName("Proposal", ".md"), "Proposal.md");
  assert.equal(localFileName("README.MD", ".md"), "README.MD");
  assert.equal(localFileName("Budget 2026", ".xlsx"), "Budget 2026.xlsx");
});

test("long names are truncated by bytes and keep the extension", () => {
  const name = localFileName(`${"ç".repeat(300)}.pdf`);
  assert.ok(Buffer.byteLength(name) <= 240);
  assert.ok(name.endsWith(".pdf"));
  assert.ok(!name.includes("�"));
});

test("duplicate names are numbered before the extension", () => {
  const taken = new Set<string>();
  assert.equal(uniqueName("report.pdf", taken), "report.pdf");
  assert.equal(uniqueName("report.pdf", taken), "report (2).pdf");
  assert.equal(uniqueName("report.pdf", taken), "report (3).pdf");
  assert.equal(uniqueName("notes", taken), "notes");
  assert.equal(uniqueName("notes", taken), "notes (2)");
});

test("link directories never start with a dot", () => {
  const taken = new Set<string>([".staging"]);
  assert.equal(linkDirectoryName(".staging", taken), "_staging");
  assert.equal(linkDirectoryName("Contracts", taken), "Contracts");
  assert.equal(linkDirectoryName("Contracts", taken), "Contracts (2)");
});

test("skipped Drive items get the sanitized, de-duplicated path of their folder", () => {
  const plan = planMirror(
    "root",
    [folder("f1", "Q1/Q2"), folder("f2", "Docs"), folder("f3", "Docs")],
    [],
    [
      { id: "form", parentId: "f1", name: "Survey", reason: "Google Forms files cannot be downloaded" },
      { id: "site", parentId: "f3", name: "Site/Home", reason: "Google Sites files cannot be downloaded" },
      { id: "top", parentId: "root", name: "Map", reason: "Google My Maps files cannot be downloaded" },
    ],
  );
  assert.deepEqual(plan.directories.sort(), ["Docs", "Docs (2)", "Q1_Q2"]);
  assert.deepEqual(plan.skipped.map((entry) => entry.path), ["Docs (2)/Site_Home", "Map", "Q1_Q2/Survey"]);
});

test("plan resolves duplicates between files and folders deterministically", () => {
  const plan = planMirror(
    "root",
    [folder("f1", "Docs"), folder("f2", "Sub", "f1")],
    [
      file("b", "Docs", { createdTime: "2026-02-01T00:00:00.000Z" }),
      file("a", "same.txt", { createdTime: "2026-01-02T00:00:00.000Z" }),
      file("c", "same.txt", { createdTime: "2026-01-01T00:00:00.000Z" }),
      file("d", "deep.txt", { parentId: "f2" }),
    ],
  );
  assert.deepEqual(plan.directories, ["Docs", "Docs/Sub"]);
  assert.deepEqual(
    plan.files.map((f) => [f.id, f.path]),
    [["c", "same.txt"], ["a", "same (2).txt"], ["b", "Docs (2)"], ["d", "Docs/Sub/deep.txt"]],
  );
});

test("first sync downloads everything and swaps the mirror into place", async () => {
  const result = await sync([file("a", "a.txt"), file("b", "b.txt", { parentId: "f1" })], emptyManifest, [folder("f1", "Sub"), folder("f2", "Empty")]);
  assert.equal(result.changed, true);
  assert.deepEqual(downloads.sort(), ["a", "b"]);
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "a:md5:a-1");
  assert.equal(await readFile(join(root, "Sub", "b.txt"), "utf-8"), "b:md5:b-1");
  assert.ok((await stat(join(root, "Empty"))).isDirectory());
  assert.deepEqual((await readdir(workDir)).sort(), ["Folder"]);
  assert.equal(result.totalBytes, result.files.reduce((sum, entry) => sum + entry.size, 0));
});

test("unchanged folders are not rebuilt or downloaded again", async () => {
  const files = [file("a", "a.txt"), file("b", "b.txt")];
  const first = await sync(files, emptyManifest);
  downloads = [];
  const second = await sync(files, first.manifest);
  assert.equal(second.changed, false);
  assert.deepEqual(downloads, []);
  assert.deepEqual(second.files.map((f) => f.path), ["a.txt", "b.txt"]);
});

test("only changed files are downloaded; the rest is reused", async () => {
  const first = await sync([file("a", "a.txt"), file("b", "b.txt")], emptyManifest);
  const before = await stat(join(root, "a.txt"));
  downloads = [];
  const second = await sync([file("a", "a.txt"), file("b", "b.txt", { fingerprint: "md5:b-2" })], first.manifest);
  assert.equal(second.changed, true);
  assert.deepEqual(downloads, ["b"]);
  assert.equal((await stat(join(root, "a.txt"))).ino, before.ino);
  assert.equal(await readFile(join(root, "b.txt"), "utf-8"), "b:md5:b-2");
});

test("renames, moves and deletions in Drive are mirrored without new downloads", async () => {
  const first = await sync([file("a", "a.txt"), file("b", "b.txt")], emptyManifest, [folder("f1", "Sub")]);
  downloads = [];
  const second = await sync([file("a", "renamed.txt", { parentId: "f1" })], first.manifest, [folder("f1", "Sub")]);
  assert.deepEqual(downloads, []);
  assert.deepEqual(second.files.map((f) => f.path), ["Sub/renamed.txt"]);
  assert.deepEqual((await readdir(root)).sort(), ["Sub"]);
  assert.equal(await readFile(join(root, "Sub", "renamed.txt"), "utf-8"), "a:md5:a-1");
});

test("files created or edited locally are replaced by the Drive version", async () => {
  const first = await sync([file("a", "a.txt")], emptyManifest);
  await writeFile(join(root, "stray.txt"), "agent output");
  await writeFile(join(root, "a.txt"), "edited locally");
  downloads = [];
  const second = await sync([file("a", "a.txt")], first.manifest);
  assert.equal(second.changed, true);
  assert.deepEqual(downloads, ["a"]);
  assert.deepEqual(await readdir(root), ["a.txt"]);
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "a:md5:a-1");
});

test("a failed update keeps the previous version and is retried only when the file changes or on a forced sync", async () => {
  const first = await sync([file("a", "a.txt")], emptyManifest);
  const failing = async () => {
    throw new Error("The owner disabled downloading this file");
  };
  const changed = file("a", "a.txt", { fingerprint: "md5:a-2", revision: "2" });
  const second = await sync([changed], first.manifest, [], { download: failing });
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "a:md5:a-1");
  assert.equal(second.files[0].fingerprint, "md5:a-1");
  assert.deepEqual(
    [second.skipped[0].reason, second.skipped[0].keptPrevious, second.skipped[0].cause],
    ["The owner disabled downloading this file", true, "download"],
  );

  downloads = [];
  const third = await sync([changed], second.manifest);
  assert.equal(third.changed, false);
  assert.deepEqual(downloads, []);
  assert.equal(third.skipped[0].keptPrevious, true);

  const renamed = await sync([changed, file("b", "b.txt")], third.manifest);
  assert.deepEqual(downloads, ["b"]);
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "a:md5:a-1");
  assert.equal(renamed.skipped[0].keptPrevious, true);

  downloads = [];
  await sync([file("a", "a.txt", { fingerprint: "md5:a-2", revision: "3" }), file("b", "b.txt")], renamed.manifest);
  assert.deepEqual(downloads, ["a"]);

  downloads = [];
  const forced = await sync([changed, file("b", "b.txt")], { ...second.manifest, signature: null }, [], { retrySkipped: true });
  assert.ok(downloads.includes("a"));
  assert.equal(forced.skipped.length, 0);
});

test("files skipped for size are not downloaded again while nothing changes", async () => {
  const doc = file("doc", "deck", { extension: ".pdf", exportMimeType: "application/pdf", fingerprint: "export:pdf:5" });
  const first = await sync([file("a", "a.txt"), doc], emptyManifest, [], { maxFileBytes: 10 });
  assert.deepEqual(downloads.sort(), ["a", "doc"]);
  assert.deepEqual(first.skipped.map((entry) => [entry.path, entry.cause, entry.size]), [["deck.pdf", "file-size", 16]]);

  downloads = [];
  const second = await sync([file("a", "a.txt"), doc], first.manifest, [], { maxFileBytes: 10 });
  assert.equal(second.changed, false);
  assert.deepEqual(downloads, []);
  assert.deepEqual(second.skipped.map((entry) => entry.path), ["deck.pdf"]);

  const third = await sync([file("a", "a.txt"), doc, file("b", "b.txt")], second.manifest, [], { maxFileBytes: 10 });
  assert.equal(third.changed, true);
  assert.deepEqual(downloads, ["b"]);
  assert.deepEqual(third.skipped.map((entry) => entry.path), ["deck.pdf"]);

  downloads = [];
  await sync([file("a", "a.txt"), doc, file("b", "b.txt")], third.manifest, [], { maxFileBytes: 1024 });
  assert.deepEqual(downloads, ["doc"]);
});

test("new files that fail to download are reported as skipped", async () => {
  const failing = async (planned: PlannedFile, destination: string) => {
    if (planned.id === "b") throw new Error("Google flagged this file as malware or spam");
    await contentDownload(planned, destination);
  };
  const result = await sync([file("a", "a.txt"), file("b", "b.txt")], emptyManifest, [], { download: failing });
  assert.deepEqual(result.files.map((f) => f.id), ["a"]);
  assert.deepEqual(result.skipped, [{ id: "b", path: "b.txt", reason: "Google flagged this file as malware or spam", cause: "download", retryKey: "md5:b-1|1|0" }]);
  assert.deepEqual(await readdir(root), ["a.txt"]);
});

test("fatal errors abort the sync and keep the current mirror intact", async () => {
  const first = await sync([file("a", "a.txt")], emptyManifest);
  const fatal = async () => {
    throw new FatalSyncError("Could not reach Google Drive");
  };
  await assert.rejects(sync([file("a", "a.txt", { fingerprint: "md5:a-2" }), file("b", "b.txt")], first.manifest, [], { download: fatal }), FatalSyncError);
  assert.deepEqual(await readdir(root), ["a.txt"]);
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "a:md5:a-1");
  assert.deepEqual(await readdir(workDir), ["Folder"]);
});

test("a folder disconnected during the sync is never written", async () => {
  await assert.rejects(sync([file("a", "a.txt")], emptyManifest, [], { canCommit: () => false }), MirrorAbortedError);
  assert.deepEqual(await readdir(workDir), []);
});

test("cancelled syncs stop before replacing the mirror", async () => {
  const controller = new AbortController();
  const first = await sync([file("a", "a.txt")], emptyManifest);
  const cancelling = async (planned: PlannedFile, destination: string) => {
    controller.abort();
    await contentDownload(planned, destination);
  };
  await assert.rejects(
    sync([file("a", "a.txt", { fingerprint: "md5:a-2" }), file("b", "b.txt")], first.manifest, [], { download: cancelling, signal: controller.signal, concurrency: 1 }),
    MirrorAbortedError,
  );
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "a:md5:a-1");
  assert.deepEqual(await readdir(workDir), ["Folder"]);
});

test("per-file and per-folder size limits skip files", async () => {
  const result = await sync(
    [
      file("big", "big.bin", { size: 2048 }),
      file("a", "a.txt", { size: 9 }),
      file("b", "b.txt", { size: 9 }),
      file("doc", "doc", { extension: ".md", exportMimeType: "text/markdown", fingerprint: "export:text/markdown:7" }),
    ],
    emptyManifest,
    [],
    { maxFileBytes: 1024, maxTotalBytes: 20, concurrency: 1 },
  );
  assert.ok(!downloads.includes("big"));
  assert.deepEqual(result.files.map((f) => f.path), ["a.txt", "b.txt"]);
  assert.deepEqual(
    result.skipped.map((s) => [s.path, s.reason]),
    [["big.bin", "Larger than the 1.0 KB file limit"], ["doc.md", "Folder size limit (20 B) reached"]],
  );
  assert.ok(result.totalBytes <= 20);
});

test("manifests round-trip and unreadable manifests start fresh", async () => {
  const path = join(workDir, "manifests", "link.json");
  const manifest: Manifest = { files: [], skipped: [{ id: "x", path: "x.form", reason: "Google Forms files cannot be downloaded" }], signature: "abc" };
  await writeManifest(path, manifest);
  assert.deepEqual(await readManifest(path), { ...manifest, folders: [], baseline: true });
  await writeFile(path, "{not json");
  assert.deepEqual(await readManifest(path), emptyManifest);
  assert.deepEqual(await readManifest(join(workDir, "missing.json")), emptyManifest);
});

test("shared byte helpers truncate UTF-8, format sizes and limit streams", async () => {
  assert.equal(truncateUtf8("ação", 3), "a\u00e7");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");

  const sink = () => new Writable({ write(_chunk, _encoding, done) { done(); } });
  const discarding = byteLimiter(4);
  await pipeline(Readable.from([Buffer.from("abc"), Buffer.from("defgh")]), discarding, sink());
  assert.equal(discarding.exceeded(), true);

  await assert.rejects(
    pipeline(Readable.from([Buffer.from("abc"), Buffer.from("defgh")]), byteLimiter(4, () => new FileTooLargeError("too big")), sink()),
    FileTooLargeError,
  );
});

test("only changes touching a mirrored folder's items or children mark it for sync", () => {
  const index = new Set(["root", "sub", "doc", "shortcut-target"]);
  assert.equal(changeAffects(index, { fileId: "doc", parents: [] }), true);
  assert.equal(changeAffects(index, { fileId: "new-file", parents: ["sub"] }), true);
  assert.equal(changeAffects(index, { fileId: "shortcut-target", parents: ["elsewhere"] }), true);
  assert.equal(changeAffects(index, { fileId: "root", parents: [] }), true);
  assert.equal(changeAffects(index, { fileId: "unrelated", parents: ["other-folder"] }), false);
  assert.equal(changeAffects(index, { fileId: null, parents: [] }), false);
});

test("Drive API errors are classified per file or as fatal", () => {
  const apiError = (status: number, reason: string) => ({
    status,
    message: `Request failed with status code ${status}`,
    response: { status, data: { error: { code: status, message: `${reason} message`, errors: [{ reason, message: `${reason} message` }] } } },
  });
  assert.equal(isFileLevelError(apiError(403, "cannotDownloadFile")), true);
  assert.equal(fileErrorMessage(apiError(403, "cannotDownloadFile")), "The owner disabled downloading this file");
  assert.equal(isFileLevelError(apiError(403, "userRateLimitExceeded")), false);
  assert.equal(isFileLevelError(apiError(429, "rateLimitExceeded")), false);
  assert.equal(isFileLevelError(apiError(401, "authError")), false);
  assert.equal(isFileLevelError(apiError(503, "backendError")), false);
  assert.equal(isFileLevelError(new FileTooLargeError("Larger than the 100 MB file limit")), true);
  assert.equal(isFileLevelError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), false);

  const streamed = { status: 403, response: { status: 403, data: JSON.stringify({ error: { message: "Export too large", errors: [{ reason: "exportSizeLimitExceeded" }] } }) } };
  assert.equal(driveErrorInfo(streamed).reason, "exportSizeLimitExceeded");
  assert.equal(fileErrorMessage(streamed), "Google Drive only exports Google files up to 10 MB");

  const oauth = { status: 400, response: { status: 400, data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } };
  assert.deepEqual(driveErrorInfo(oauth), { status: 400, reason: "invalid_grant", message: "Token has been expired or revoked." });
});
