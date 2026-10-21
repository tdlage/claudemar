import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FatalSyncError, applyMirror, planMirror, scanLocalTree, type LocalTree, type Manifest, type MirrorFile, type MirrorFolder } from "../src/google-drive/mirror.js";
import type { DriveTree, DriveWriter, RemoteFile } from "../src/google-drive/drive-api.js";
import { detectLocalChanges, hasLocalChanges, isMassDeletion, pushLocalChanges, salvageAfterSwap } from "../src/google-drive/two-way.js";

const output = resolve(import.meta.dirname, "../../.output/google-drive-two-way-test");
await mkdir(output, { recursive: true });
const base = await mkdtemp(resolve(output, "run-"));
let workDir: string;
let root: string;
let unsyncedDir: string;

after(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  workDir = await mkdtemp(resolve(base, "case-"));
  root = join(workDir, "Folder");
  unsyncedDir = join(workDir, "unsynced");
});

const md5 = (content: string | Buffer) => createHash("md5").update(content).digest("hex");

function remoteFile(id: string, name: string, content: string, parentId = "root", overrides: Partial<MirrorFile> = {}): MirrorFile {
  return {
    id,
    sourceId: id,
    parentId,
    name,
    extension: "",
    fingerprint: `md5:${md5(content)}`,
    revision: "1",
    size: Buffer.byteLength(content),
    mimeType: "text/plain",
    exportMimeType: null,
    createdTime: "2026-01-01T00:00:00.000Z",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    webViewLink: null,
    ...overrides,
  };
}

class MemoryDrive implements DriveWriter {
  operations: string[] = [];
  contents = new Map<string, string>();
  names = new Map<string, string>();
  failures = new Map<string, unknown>();
  private nextId = 1;

  private check(operation: string) {
    this.operations.push(operation);
    const failure = this.failures.get(operation);
    if (failure) throw failure;
  }

  private written(id: string, name: string, content: string, overrides: Partial<RemoteFile> = {}): RemoteFile {
    this.contents.set(id, content);
    this.names.set(id, name);
    const { parentId: _parentId, ...file } = remoteFile(id, name, content, "", { revision: String(this.nextId), ...overrides });
    return file;
  }

  async createFolder(parentId: string, name: string) {
    this.check(`createFolder ${name} in ${parentId}`);
    return `folder-${this.nextId++}`;
  }

  async createFile(parentId: string, name: string, localPath: string) {
    this.check(`createFile ${name} in ${parentId}`);
    return this.written(`new-${this.nextId++}`, name, await readFile(localPath, "utf-8"));
  }

  async updateContent(fileId: string, localPath: string) {
    this.check(`updateContent ${fileId}`);
    return this.written(fileId, this.names.get(fileId) ?? fileId, await readFile(localPath, "utf-8"));
  }

  async move(fileId: string, name: string, fromParentId: string, toParentId: string) {
    this.check(`move ${fileId} to ${name} from ${fromParentId} to ${toParentId}`);
    return this.written(fileId, name, this.contents.get(fileId) ?? "");
  }

  async trash(fileId: string) {
    this.check(`trash ${fileId}`);
  }
}

const fileLevelError = (reason: string) => ({ status: 403, response: { status: 403, data: { error: { message: `${reason} message`, errors: [{ reason }] } } } });

async function mirror(folders: MirrorFolder[], files: MirrorFile[], contents: Record<string, string>): Promise<{ manifest: Manifest; tree: DriveTree }> {
  const plan = planMirror("root", folders, files);
  const result = await applyMirror({
    root,
    workDir,
    key: "link",
    plan,
    previous: { files: [], skipped: [], signature: null },
    concurrency: 2,
    maxFileBytes: 0,
    maxTotalBytes: 0,
    fileMode: (entry) => (entry.readOnly ? 0o444 : 0o644),
    download: async (file, destination) => writeFile(destination, contents[file.id]),
  });
  return {
    manifest: { files: result.files, skipped: [], folders: plan.folders, signature: result.signature, baseline: true },
    tree: { folders: [...folders], files: [...files], skipped: [], truncated: false },
  };
}

async function age(path: string) {
  const old = new Date(Date.now() - 60_000);
  await utimes(join(root, path), old, old);
}

async function local(): Promise<LocalTree> {
  const tree = await scanLocalTree(root);
  assert.ok(tree);
  return tree;
}

function context(state: { manifest: Manifest; tree: DriveTree }, writer: MemoryDrive) {
  for (const file of state.tree.files) writer.names.set(file.id, file.name);
  return { root, rootFolderId: "root", tree: state.tree, manifest: state.manifest, writer, unsyncedDir, unsyncedLabel: "output/google-drive-unsynced/Folder", now: new Date("2026-10-21T09:30:00Z") };
}

test("local edits, renames, deletions and new files are detected against the last sync", async () => {
  const state = await mirror([{ id: "sub", parentId: "root", name: "Sub", createdTime: null }], [
    remoteFile("a", "a.txt", "alpha"),
    remoteFile("b", "b.txt", "bravo"),
    remoteFile("c", "c.txt", "charlie", "sub"),
    remoteFile("d", "d.txt", "delta"),
  ], { a: "alpha", b: "bravo", c: "charlie", d: "delta" });

  await writeFile(join(root, "a.txt"), "alpha v2");
  await age("a.txt");
  await rename(join(root, "b.txt"), join(root, "Sub", "b-renamed.txt"));
  await unlink(join(root, "d.txt"));
  await mkdir(join(root, "New"));
  await writeFile(join(root, "New", "e.txt"), "echo");
  await age("New/e.txt");
  await writeFile(join(root, "fresh.txt"), "still being written");
  await symlink("/etc/hostname", join(root, "link.txt"));

  const changes = detectLocalChanges(state.manifest, await local(), Date.now() - 10_000);
  assert.deepEqual(changes.modified.map((c) => c.entry.id), ["a"]);
  assert.deepEqual(changes.moved.map((c) => [c.entry.id, c.path]), [["b", "Sub/b-renamed.txt"]]);
  assert.deepEqual(changes.deleted.map((e) => e.id), ["d"]);
  assert.deepEqual(changes.created.map((c) => c.path), ["New/e.txt"]);
  assert.deepEqual(changes.unsettled.sort(), ["fresh.txt", "link.txt"]);
  assert.deepEqual(changes.createdDirectories, ["New"]);
  assert.deepEqual(changes.deletedDirectories, []);
  assert.equal(hasLocalChanges(changes), true);
  const linkChanges = detectLocalChanges(state.manifest, await local(), Date.now() + 1_000);
  assert.ok(linkChanges.unsupported.includes("link.txt"));
});

test("an untouched mirror has no local changes", async () => {
  const state = await mirror([], [remoteFile("a", "a.txt", "alpha")], { a: "alpha" });
  assert.equal(hasLocalChanges(detectLocalChanges(state.manifest, await local(), Date.now())), false);
});

test("pushing uploads new files into new folders, updates edits and applies renames and deletions", async () => {
  const state = await mirror([{ id: "sub", parentId: "root", name: "Sub", createdTime: null }], [
    remoteFile("a", "a.txt", "alpha"),
    remoteFile("b", "b.txt", "bravo"),
    remoteFile("d", "d.txt", "delta"),
  ], { a: "alpha", b: "bravo", d: "delta" });
  await writeFile(join(root, "a.txt"), "alpha v2");
  await rename(join(root, "b.txt"), join(root, "Sub", "b2.txt"));
  await unlink(join(root, "d.txt"));
  await mkdir(join(root, "Reports", "2026"), { recursive: true });
  await writeFile(join(root, "Reports", "2026", "q3.md"), "# Q3");

  const writer = new MemoryDrive();
  writer.contents.set("b", "bravo");
  const changes = detectLocalChanges(state.manifest, await local(), Date.now() + 1_000);
  const notes = await pushLocalChanges(context(state, writer), changes);

  assert.deepEqual(notes, []);
  assert.deepEqual(writer.operations, [
    "trash d",
    "move b to b2.txt from root to sub",
    "updateContent a",
    "createFolder Reports in root",
    "createFolder 2026 in folder-1",
    "createFile q3.md in folder-2",
  ]);
  const byPath = new Map(state.manifest.files.map((entry) => [entry.path, entry]));
  assert.equal(byPath.get("a.txt")!.fingerprint, `md5:${md5("alpha v2")}`);
  assert.equal(byPath.get("Sub/b2.txt")!.id, "b");
  assert.ok(!byPath.has("d.txt"));
  assert.equal(byPath.get("Reports/2026/q3.md")!.id, "new-3");
  assert.deepEqual(state.manifest.folders!.map((f) => f.path).sort(), ["Reports", "Reports/2026", "Sub"]);
  assert.equal(hasLocalChanges(detectLocalChanges(state.manifest, await local(), Date.now() + 1_000)), false);

  const plan = planMirror("root", state.tree.folders, state.tree.files);
  assert.deepEqual(plan.files.map((f) => f.path).sort(), ["Reports/2026/q3.md", "Sub/b2.txt", "a.txt"]);
});

test("conflicting edits keep both versions and remote deletions are respected", async () => {
  const state = await mirror([], [remoteFile("a", "a.txt", "alpha"), remoteFile("d", "d.txt", "delta")], { a: "alpha", d: "delta" });
  state.tree.files = [remoteFile("a", "a.txt", "alpha edited in drive"), remoteFile("d", "d.txt", "delta changed")];
  await writeFile(join(root, "a.txt"), "alpha edited by agent");
  await unlink(join(root, "d.txt"));

  const writer = new MemoryDrive();
  const notes = await pushLocalChanges(context(state, writer), detectLocalChanges(state.manifest, await local(), Date.now() + 1_000));

  assert.deepEqual(writer.operations, ["createFile a (conflict copy 2026-10-21 09.30).txt in root"]);
  assert.deepEqual((await readdir(root)).sort(), ["a (conflict copy 2026-10-21 09.30).txt"]);
  assert.equal(writer.contents.get("new-1"), "alpha edited by agent");
  assert.equal(state.manifest.files.find((e) => e.id === "a")!.fingerprint, `md5:${md5("alpha")}`);
  assert.deepEqual(notes.map((n) => n.path).sort(), ["a.txt", "d.txt"]);
  assert.match(notes.find((n) => n.path === "d.txt")!.reason, /changed in Google Drive since the last sync, so it was kept/);
});

test("edits to converted Google files and uploads that fail are moved aside, fatal errors keep progress", async () => {
  const doc = remoteFile("doc", "Plan", "# plan", "root", { extension: ".md", exportMimeType: "text/markdown", fingerprint: "export:text/markdown:1", size: null });
  const state = await mirror([], [doc, remoteFile("a", "a.txt", "alpha")], { doc: "# plan", a: "alpha" });
  assert.equal((await lstat(join(root, "Plan.md"))).mode & 0o777, 0o444);
  await rm(join(root, "Plan.md"));
  await writeFile(join(root, "Plan.md"), "# plan edited");
  await writeFile(join(root, "blocked.txt"), "no permission");
  await writeFile(join(root, "later.txt"), "network will fail");

  const writer = new MemoryDrive();
  writer.failures.set("createFile blocked.txt in root", fileLevelError("insufficientFilePermissions"));
  writer.failures.set("createFile later.txt in root", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
  const changes = detectLocalChanges(state.manifest, await local(), Date.now() + 1_000);
  await assert.rejects(pushLocalChanges(context(state, writer), changes), FatalSyncError);

  assert.equal(await readFile(join(unsyncedDir, "Plan.md"), "utf-8"), "# plan edited");
  assert.equal(await readFile(join(unsyncedDir, "blocked.txt"), "utf-8"), "no permission");
  assert.ok(await stat(join(root, "later.txt")));
  assert.ok(!state.manifest.files.some((e) => e.path === "later.txt"));
});

test("native renames drop the export extension and deleted folders are trashed only when empty in Drive", async () => {
  const doc = remoteFile("doc", "Plan", "# plan", "root", { extension: ".md", exportMimeType: "text/markdown", fingerprint: "export:text/markdown:1", size: null });
  const folders = [{ id: "old", parentId: "root", name: "Old", createdTime: null }, { id: "busy", parentId: "root", name: "Busy", createdTime: null }];
  const state = await mirror(folders, [doc, remoteFile("x", "x.txt", "x", "old"), remoteFile("y", "y.txt", "y", "busy")], { doc: "# plan", x: "x", y: "y" });
  state.tree.files.push(remoteFile("z", "z.txt", "added in drive", "busy"));
  await rename(join(root, "Plan.md"), join(root, "Roadmap.md"));
  await rm(join(root, "Old"), { recursive: true });
  await rm(join(root, "Busy"), { recursive: true });

  const writer = new MemoryDrive();
  const notes = await pushLocalChanges(context(state, writer), detectLocalChanges(state.manifest, await local(), Date.now() + 1_000));
  assert.ok(writer.operations.includes("move doc to Roadmap from root to root"));
  assert.ok(writer.operations.includes("trash x"));
  assert.ok(writer.operations.includes("trash y"));
  assert.ok(writer.operations.includes("trash old"));
  assert.ok(!writer.operations.includes("trash busy"));
  assert.ok(notes.some((n) => n.path === "Busy" && /still has files/.test(n.reason)));
});

test("mass deletions are detected", async () => {
  const files = Array.from({ length: 30 }, (_, i) => remoteFile(`f${i}`, `f${i}.txt`, `content ${i}`));
  const state = await mirror([], files, Object.fromEntries(files.map((f, i) => [f.id, `content ${i}`])));
  for (let i = 0; i < 25; i++) await unlink(join(root, `f${i}.txt`));
  assert.equal(isMassDeletion(detectLocalChanges(state.manifest, await local(), Date.now()), state.manifest), true);
});

test("files written during the swap are salvaged instead of lost", async () => {
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "kept.txt"), "kept");
  const snapshot = await local();
  const trash = join(workDir, "trash");
  await rename(root, trash);
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "occupied.txt"), "from drive");
  await writeFile(join(trash, "sub", "late.txt"), "written during sync");
  await writeFile(join(trash, "occupied.txt"), "agent version");

  const rescued = await salvageAfterSwap(trash, snapshot, root, unsyncedDir);
  assert.deepEqual(rescued.sort(), ["occupied.txt", "sub/late.txt"]);
  assert.equal(await readFile(join(root, "sub", "late.txt"), "utf-8"), "written during sync");
  assert.equal(await readFile(join(root, "occupied.txt"), "utf-8"), "from drive");
  assert.equal(await readFile(join(unsyncedDir, "occupied.txt"), "utf-8"), "agent version");
});

test("a sync aborts without touching the folder when local files change before the swap", async () => {
  const state = await mirror([], [remoteFile("a", "a.txt", "alpha")], { a: "alpha" });
  const plan = planMirror("root", [], [remoteFile("a", "a.txt", "alpha v2 from drive")]);
  await assert.rejects(applyMirror({
    root,
    workDir,
    key: "link",
    plan,
    previous: state.manifest,
    concurrency: 1,
    maxFileBytes: 0,
    maxTotalBytes: 0,
    download: async (_file, destination) => writeFile(destination, "alpha v2 from drive"),
    beforeCommit: async () => {
      throw new Error("Local files changed during the sync");
    },
  }), /Local files changed/);
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "alpha");
  assert.deepEqual(await readdir(workDir), ["Folder"]);
});

test("after pushing, rebuilding the mirror reuses the uploaded files without downloading them again", async () => {
  const doc = remoteFile("doc", "Plan", "# plan", "root", { extension: ".md", exportMimeType: "text/markdown", fingerprint: "export:text/markdown:1", size: null });
  const state = await mirror([{ id: "sub", parentId: "root", name: "Sub", createdTime: null }], [doc, remoteFile("a", "a.txt", "alpha"), remoteFile("b", "b.txt", "bravo")], { doc: "# plan", a: "alpha", b: "bravo" });
  await writeFile(join(root, "a.txt"), "alpha v2");
  await rename(join(root, "b.txt"), join(root, "Sub", "b.txt"));
  await writeFile(join(root, "Sub", "new.txt"), "new");
  const writer = new MemoryDrive();
  await pushLocalChanges(context(state, writer), detectLocalChanges(state.manifest, await local(), Date.now() + 1_000));

  const downloads: string[] = [];
  const result = await applyMirror({
    root,
    workDir,
    key: "link",
    plan: planMirror("root", state.tree.folders, state.tree.files),
    previous: { ...state.manifest, signature: null },
    concurrency: 2,
    maxFileBytes: 0,
    maxTotalBytes: 0,
    fileMode: (entry) => (entry.readOnly ? 0o444 : 0o644),
    download: async (file, destination) => {
      downloads.push(file.id);
      await writeFile(destination, "unexpected");
    },
  });
  assert.deepEqual(downloads, []);
  assert.deepEqual(result.files.map((f) => f.path), ["a.txt", "Plan.md", "Sub/b.txt", "Sub/new.txt"]);
  assert.equal(await readFile(join(root, "a.txt"), "utf-8"), "alpha v2");
  assert.equal((await stat(join(root, "Plan.md"))).mode & 0o777, 0o444);
  assert.equal((await stat(join(root, "Sub", "new.txt"))).mode & 0o777, 0o644);
  assert.equal(hasLocalChanges(detectLocalChanges({ ...state.manifest, files: result.files }, await local(), Date.now() + 1_000)), false);
});
