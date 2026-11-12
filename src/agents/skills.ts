import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import matter from "gray-matter";
import { dump, load } from "js-yaml";
import { getAgentPaths } from "./manager.js";
import { ArchiveError, fetchGithubFiles, isZip, parseGithubUrl, readZip, type ArchiveFile } from "./skill-archive.js";

export const SKILL_INVOCATIONS = ["auto", "manual", "model"] as const;
export type SkillInvocation = (typeof SKILL_INVOCATIONS)[number];

export interface SkillTrigger {
  description: string;
  whenToUse: string;
  invocation: SkillInvocation;
}

export interface SkillView extends SkillTrigger {
  name: string;
  fileCount: number;
  totalBytes: number;
  updatedAt: string;
}

export interface SkillDetail extends SkillView {
  instructions: string;
  files: { path: string; size: number }[];
}

export interface LibrarySkillView {
  name: string;
  description: string;
  installed: boolean;
}

export interface SkillCandidate {
  name: string;
  description: string;
  path: string;
}

export interface SkillInput extends SkillTrigger {
  instructions: string;
}

export class SkillError extends Error {
  constructor(readonly status: number, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

interface SkillPackage {
  name: string;
  description: string;
  path: string;
  files: Map<string, ArchiveFile>;
}

const SKILL_FILE = "SKILL.md";
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_LISTING_LENGTH = 1536;
const LIBRARY_DIR = resolve(homedir(), ".claude", "skills");
const CODEX_POLICY_FILE = join("agents", "openai.yaml");
const CODEX_LINK_PREFIX = "../../.claude/skills/";

function agentRoot(agentName: string): string {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.root)) throw new SkillError(404, "Agente não encontrado");
  return paths.root;
}

function claudeSkillsDir(root: string): string {
  return resolve(root, ".claude", "skills");
}

function codexSkillsDir(root: string): string {
  return resolve(root, ".agents", "skills");
}

function flag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface ParsedSkill {
  data: Record<string, unknown>;
  body: string;
}

function parseSkillMd(content: string): ParsedSkill {
  try {
    const parsed = matter(content);
    return { data: { ...parsed.data }, body: parsed.content };
  } catch {
    return { data: {}, body: content };
  }
}

function triggerOf(data: Record<string, unknown>): SkillTrigger {
  const invocation: SkillInvocation = flag(data["disable-model-invocation"]) === true
    ? "manual"
    : flag(data["user-invocable"]) === false ? "model" : "auto";
  return { description: text(data.description), whenToUse: text(data.when_to_use), invocation };
}

function validName(name: string): boolean {
  return name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name);
}

function assertName(name: string): void {
  if (!validName(name)) {
    throw new SkillError(400, `Nome de skill inválido: "${name}". Use até ${MAX_NAME_LENGTH} caracteres com letras minúsculas, números e hífens (ex.: relatorio-semanal).`);
  }
}

function assertTrigger(trigger: SkillTrigger): void {
  if (!trigger.description) throw new SkillError(400, "A descrição é obrigatória: é por ela que o agente decide quando usar a skill.");
  if (trigger.description.length + trigger.whenToUse.length > MAX_LISTING_LENGTH) {
    throw new SkillError(400, `Descrição e "quando usar" somam mais de ${MAX_LISTING_LENGTH} caracteres; o excesso seria cortado.`);
  }
  if (!SKILL_INVOCATIONS.includes(trigger.invocation)) throw new SkillError(400, "Modo de acionamento inválido");
}

function walkFiles(dir: string): { path: string; size: number; mtimeMs: number }[] {
  const out: { path: string; size: number; mtimeMs: number }[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const info = statSync(full);
        out.push({ path: relative(dir, full).split("\\").join("/"), size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  };
  visit(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function skillDirs(root: string): string[] {
  const dir = claudeSkillsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && validName(entry.name) && existsSync(join(dir, entry.name, SKILL_FILE)))
    .map((entry) => entry.name)
    .sort();
}

function skillView(dir: string, name: string): SkillView {
  const files = walkFiles(dir);
  const skillMd = join(dir, SKILL_FILE);
  return {
    name,
    ...triggerOf(parseSkillMd(readFileSync(skillMd, "utf-8")).data),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    updatedAt: new Date(Math.max(...files.map((file) => file.mtimeMs))).toISOString(),
  };
}

function skillDir(root: string, name: string): string {
  assertName(name);
  const dir = join(claudeSkillsDir(root), name);
  if (!existsSync(join(dir, SKILL_FILE))) throw new SkillError(404, `Skill "${name}" não encontrada`);
  return dir;
}

export function listAgentSkills(agentName: string): SkillView[] {
  const root = agentRoot(agentName);
  return skillDirs(root).map((name) => skillView(join(claudeSkillsDir(root), name), name));
}

export function agentSkillCount(agentName: string): number {
  const paths = getAgentPaths(agentName);
  return paths ? skillDirs(paths.root).length : 0;
}

export function getAgentSkill(agentName: string, name: string): SkillDetail {
  const root = agentRoot(agentName);
  const dir = skillDir(root, name);
  return {
    ...skillView(dir, name),
    instructions: parseSkillMd(readFileSync(join(dir, SKILL_FILE), "utf-8")).body.replace(/^\n+/, ""),
    files: walkFiles(dir).map(({ path, size }) => ({ path, size })),
  };
}

export function userInvocableSkill(agentName: string, name: string): boolean {
  if (!validName(name)) return false;
  const paths = getAgentPaths(agentName);
  const skillMd = paths ? join(claudeSkillsDir(paths.root), name, SKILL_FILE) : null;
  return skillMd !== null && existsSync(skillMd) && triggerOf(parseSkillMd(readFileSync(skillMd, "utf-8")).data).invocation !== "model";
}

// Muda quando skills são instaladas, editadas ou removidas, para a próxima mensagem abrir uma sessão nova.
export function agentSkillsSignature(agentName: string): string {
  const paths = getAgentPaths(agentName);
  if (!paths) return "skills:";
  const dir = claudeSkillsDir(paths.root);
  return `skills:${skillDirs(paths.root).map((name) => `${name}@${statSync(join(dir, name, SKILL_FILE)).mtimeMs}`).join(",")}`;
}

// O Codex procura skills em .agents/skills; cada skill do agente ganha um link para a pasta em .claude/skills.
export function syncCodexSkillLinks(agentName: string): void {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.root)) return;
  const names = new Set(skillDirs(paths.root));
  const target = codexSkillsDir(paths.root);
  if (names.size === 0 && !existsSync(target)) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const link = join(target, entry.name);
    if (readlinkSync(link).startsWith(CODEX_LINK_PREFIX) && !names.has(entry.name)) unlinkSync(link);
  }
  for (const name of names) {
    const link = join(target, name);
    let exists = true;
    try {
      lstatSync(link);
    } catch {
      exists = false;
    }
    if (!exists) symlinkSync(`${CODEX_LINK_PREFIX}${name}`, link);
  }
}

function frontmatterOrder(data: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of ["name", "description", "when_to_use"]) if (data[key] !== undefined) ordered[key] = data[key];
  for (const [key, value] of Object.entries(data)) if (!(key in ordered)) ordered[key] = value;
  return ordered;
}

function renderSkillMd(data: Record<string, unknown>, body: string): string {
  return `---\n${dump(frontmatterOrder(data), { lineWidth: -1 })}---\n\n${body.replace(/^\n+/, "").replace(/\s*$/, "\n")}`;
}

function applyTrigger(data: Record<string, unknown>, trigger: SkillTrigger): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data, description: trigger.description };
  if (trigger.whenToUse) next.when_to_use = trigger.whenToUse;
  else delete next.when_to_use;
  delete next["disable-model-invocation"];
  delete next["user-invocable"];
  if (trigger.invocation === "manual") next["disable-model-invocation"] = true;
  if (trigger.invocation === "model") next["user-invocable"] = false;
  return next;
}

function readYaml(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = load(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// O equivalente do Codex ao disable-model-invocation é policy.allow_implicit_invocation em agents/openai.yaml.
async function syncCodexPolicy(dir: string, invocation: SkillInvocation): Promise<void> {
  const path = join(dir, CODEX_POLICY_FILE);
  const config = readYaml(path);
  const policy = config.policy && typeof config.policy === "object" ? { ...(config.policy as Record<string, unknown>) } : {};
  const implicit = invocation !== "manual";
  if (implicit && !existsSync(path)) return;
  if (implicit) delete policy.allow_implicit_invocation;
  else policy.allow_implicit_invocation = false;
  if (Object.keys(policy).length > 0) config.policy = policy;
  else delete config.policy;
  if (Object.keys(config).length === 0) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, dump(config, { lineWidth: -1 }));
}

function describePackage(path: string, files: Map<string, ArchiveFile>): SkillPackage {
  const skillMd = files.get(SKILL_FILE);
  if (!skillMd) throw new SkillError(400, `Nenhum ${SKILL_FILE} em "${path || "/"}".`);
  const { data } = parseSkillMd(skillMd.data.toString("utf-8"));
  const where = path ? ` (${path})` : "";
  const name = text(data.name) || (path ? basename(path) : "");
  if (!name) throw new SkillError(400, `O ${SKILL_FILE}${where} precisa do campo name no frontmatter.`);
  assertName(name);
  const description = text(data.description);
  if (!description) throw new SkillError(400, `O ${SKILL_FILE} da skill "${name}" precisa do campo description no frontmatter.`);
  return { name, description, path, files };
}

// Cada pasta com SKILL.md vira uma skill; SKILL.md aninhados dentro de outra skill fazem parte dela.
function packagesFrom(files: Map<string, ArchiveFile>): SkillPackage[] {
  const roots = [...files.keys()]
    .filter((path) => posix.basename(path) === SKILL_FILE)
    .map((path) => posix.dirname(path) === "." ? "" : posix.dirname(path))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const accepted: string[] = [];
  for (const root of roots) {
    if (!accepted.some((parent) => parent === "" || root.startsWith(`${parent}/`))) accepted.push(root);
  }
  if (accepted.length === 0) throw new SkillError(400, `Nenhum ${SKILL_FILE} encontrado.`);
  return accepted.map((root) => {
    const prefix = root ? `${root}/` : "";
    const own = new Map<string, ArchiveFile>();
    for (const [path, file] of files) if (path.startsWith(prefix)) own.set(path.slice(prefix.length), file);
    return describePackage(root, own);
  });
}

async function writePackage(stagingDir: string, pkg: SkillPackage): Promise<void> {
  for (const [path, file] of pkg.files) {
    const target = resolve(stagingDir, path);
    if (!target.startsWith(`${stagingDir}/`)) throw new SkillError(400, `Caminho inválido: "${path}"`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.data);
    await chmod(target, file.executable ? 0o755 : 0o644);
  }
}

// Se o pacote veio com allow_implicit_invocation: false para o Codex, o Claude passa a respeitar o mesmo modo manual.
async function reconcileInvocation(dir: string): Promise<void> {
  const skillMd = join(dir, SKILL_FILE);
  const parsed = parseSkillMd(await readFile(skillMd, "utf-8"));
  const trigger = triggerOf(parsed.data);
  const policy = readYaml(join(dir, CODEX_POLICY_FILE)).policy as Record<string, unknown> | undefined;
  if (trigger.invocation !== "manual" && policy && flag(policy.allow_implicit_invocation) === false) {
    await writeFile(skillMd, renderSkillMd(applyTrigger(parsed.data, { ...trigger, invocation: "manual" }), parsed.body));
    return;
  }
  await syncCodexPolicy(dir, trigger.invocation);
}

async function installPackages(agentName: string, packages: SkillPackage[], replace: boolean): Promise<string[]> {
  const root = agentRoot(agentName);
  const names = packages.map((pkg) => pkg.name);
  const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicated.length > 0) throw new SkillError(400, `Mais de uma skill com o nome: ${[...new Set(duplicated)].join(", ")}`);
  const skillsDir = claudeSkillsDir(root);
  const conflicts = names.filter((name) => existsSync(join(skillsDir, name)));
  if (conflicts.length > 0 && !replace) {
    throw new SkillError(409, `Já existe skill com o nome: ${conflicts.join(", ")}`, { conflicts });
  }
  await mkdir(skillsDir, { recursive: true });
  for (const pkg of packages) {
    const staging = resolve(root, ".claude", `.skill-staging-${randomUUID()}`);
    try {
      await writePackage(staging, pkg);
      await reconcileInvocation(staging);
      const target = join(skillsDir, pkg.name);
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  syncCodexSkillLinks(agentName);
  return names;
}

function archiveFailure(err: unknown): never {
  if (err instanceof ArchiveError) throw new SkillError(400, err.message);
  throw err;
}

export async function installFromUpload(agentName: string, buffer: Buffer, replace: boolean): Promise<string[]> {
  if (buffer.length === 0) throw new SkillError(400, "Arquivo vazio");
  if (isZip(buffer)) {
    const files = await readZip(buffer).catch(archiveFailure);
    return installPackages(agentName, packagesFrom(files), replace);
  }
  const content = buffer.toString("utf-8");
  if (!content.trimStart().startsWith("---")) throw new SkillError(400, `Envie um .zip, um .skill ou um ${SKILL_FILE} com frontmatter.`);
  return installPackages(agentName, [describePackage("", new Map([[SKILL_FILE, { data: buffer, executable: false }]]))], replace);
}

export async function installFromGithub(agentName: string, url: string, selected: string[] | null, replace: boolean): Promise<{ installed: string[]; candidates: SkillCandidate[] }> {
  agentRoot(agentName);
  let packages: SkillPackage[];
  try {
    packages = packagesFrom(await fetchGithubFiles(parseGithubUrl(url)));
  } catch (err) {
    archiveFailure(err);
  }
  const candidates = packages.map(({ name, description, path }) => ({ name, description, path }));
  if (!selected) {
    if (packages.length > 1) return { installed: [], candidates };
    return { installed: await installPackages(agentName, packages, replace), candidates };
  }
  const chosen = packages.filter((pkg) => selected.includes(pkg.name));
  if (chosen.length === 0) throw new SkillError(400, "Nenhuma das skills escolhidas existe nesse endereço.");
  return { installed: await installPackages(agentName, chosen, replace), candidates };
}

function librarySkillNames(): string[] {
  if (!existsSync(LIBRARY_DIR)) return [];
  return readdirSync(LIBRARY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && validName(entry.name) && existsSync(join(LIBRARY_DIR, entry.name, SKILL_FILE)))
    .map((entry) => entry.name)
    .sort();
}

export function listLibrarySkills(agentName: string): LibrarySkillView[] {
  const installed = new Set(listAgentSkills(agentName).map((skill) => skill.name));
  return librarySkillNames().map((name) => ({
    name,
    description: triggerOf(parseSkillMd(readFileSync(join(LIBRARY_DIR, name, SKILL_FILE), "utf-8")).data).description,
    installed: installed.has(name),
  }));
}

export async function installFromLibrary(agentName: string, name: string, replace: boolean): Promise<string[]> {
  if (!librarySkillNames().includes(name)) throw new SkillError(404, `A skill "${name}" não está na biblioteca do servidor`);
  const dir = join(LIBRARY_DIR, name);
  const files = new Map<string, ArchiveFile>();
  for (const file of walkFiles(dir)) {
    const full = join(dir, file.path);
    files.set(file.path, { data: await readFile(full), executable: (statSync(full).mode & 0o111) !== 0 });
  }
  return installPackages(agentName, [describePackage(name, files)], replace);
}

export async function createSkill(agentName: string, name: string, input: SkillInput): Promise<SkillDetail> {
  assertName(name);
  assertTrigger(input);
  const content = renderSkillMd(applyTrigger({ name }, input), input.instructions);
  await installPackages(agentName, [{ name, description: input.description, path: "", files: new Map([[SKILL_FILE, { data: Buffer.from(content), executable: false }]]) }], false);
  return getAgentSkill(agentName, name);
}

export async function updateSkill(agentName: string, name: string, input: SkillInput): Promise<SkillDetail> {
  assertTrigger(input);
  const dir = skillDir(agentRoot(agentName), name);
  const skillMd = join(dir, SKILL_FILE);
  const parsed = parseSkillMd(await readFile(skillMd, "utf-8"));
  await writeFile(skillMd, renderSkillMd(applyTrigger(parsed.data, input), input.instructions));
  await syncCodexPolicy(dir, input.invocation);
  return getAgentSkill(agentName, name);
}

export async function removeSkill(agentName: string, name: string): Promise<void> {
  const dir = skillDir(agentRoot(agentName), name);
  await rm(dir, { recursive: true, force: true });
  syncCodexSkillLinks(agentName);
}
