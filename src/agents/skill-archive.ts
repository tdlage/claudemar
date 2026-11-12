import { fromBuffer, type Entry, type ZipFile } from "yauzl";

export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 2000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SYMLINK_MODE = 0o120000;
const FILE_TYPE_MASK = 0o170000;
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;
const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.*?))?)?\/?$/;

export class ArchiveError extends Error {}

export interface ArchiveFile {
  data: Buffer;
  executable: boolean;
}

export interface GithubSource {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

function isSafePath(path: string): boolean {
  return !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && path.split("/").every((part) => part !== ".." && part !== "");
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) reject(new ArchiveError(`Arquivo zip inválido: ${err?.message ?? "não foi possível ler"}`));
      else resolve(zip);
    });
  });
}

// Lê os arquivos do zip em memória com limites de quantidade e tamanho; links simbólicos e caminhos
// que escapam da pasta são recusados.
export async function readZip(buffer: Buffer, include: (path: string) => boolean = () => true): Promise<Map<string, ArchiveFile>> {
  const zip = await openZip(buffer);
  const files = new Map<string, ArchiveFile>();
  let total = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(err instanceof ArchiveError ? err : new ArchiveError(`Arquivo zip inválido: ${err instanceof Error ? err.message : String(err)}`));
    };
    zip.on("error", fail);
    zip.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(files);
    });
    zip.on("entry", (entry: Entry) => {
      const path = entry.fileName.replace(/\\/g, "/");
      if (path.endsWith("/") || JUNK.test(path) || !include(path)) {
        zip.readEntry();
        return;
      }
      const unixMode = entry.externalFileAttributes >>> 16;
      if ((unixMode & FILE_TYPE_MASK) === SYMLINK_MODE) return fail(new ArchiveError(`"${path}" é um link simbólico, o que não é permitido em skills.`));
      if (!isSafePath(path)) return fail(new ArchiveError(`Caminho inválido no zip: "${path}".`));
      if (files.size >= MAX_FILES) return fail(new ArchiveError(`O zip tem mais de ${MAX_FILES} arquivos.`));
      if (entry.uncompressedSize > MAX_FILE_BYTES) return fail(new ArchiveError(`"${path}" passa do limite de ${MAX_FILE_BYTES / 1024 / 1024} MB por arquivo.`));
      total += entry.uncompressedSize;
      if (total > MAX_EXTRACTED_BYTES) return fail(new ArchiveError(`O conteúdo descompactado passa de ${MAX_EXTRACTED_BYTES / 1024 / 1024} MB.`));
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err ?? new Error("falha ao ler"));
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", fail);
        stream.on("end", () => {
          files.set(path, { data: Buffer.concat(chunks), executable: (unixMode & 0o111) !== 0 });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

export function parseGithubUrl(url: string): GithubSource {
  const match = GITHUB_URL.exec(url.trim());
  if (!match) throw new ArchiveError("Use o endereço de um repositório público do GitHub, por exemplo https://github.com/anthropics/skills/tree/main/skills/pdf.");
  const [, owner, repo, kind, ref, rawPath] = match;
  let path = (rawPath ?? "").replace(/\/+$/, "");
  if (kind === "blob") path = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (path && !isSafePath(path)) throw new ArchiveError("Caminho inválido no endereço do GitHub.");
  return { owner, repo, ref: ref ?? "HEAD", path };
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (response.status === 404) throw new ArchiveError("Repositório, branch ou pasta não encontrados. Só repositórios públicos são suportados.");
  if (!response.ok || !response.body) throw new ArchiveError(`O GitHub respondeu HTTP ${response.status}.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_ARCHIVE_BYTES * 2) throw new ArchiveError("O repositório é grande demais para importar. Aponte para a pasta da skill ou envie um zip.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Baixa o zip do repositório e devolve só os arquivos dentro de `source.path`, com caminhos relativos a ela.
export async function fetchGithubFiles(source: GithubSource): Promise<Map<string, ArchiveFile>> {
  const buffer = await download(`https://github.com/${source.owner}/${source.repo}/archive/${encodeURIComponent(source.ref)}.zip`);
  const prefix = source.path ? `${source.path}/` : "";
  const strip = (path: string) => path.slice(path.indexOf("/") + 1);
  const files = await readZip(buffer, (path) => path.includes("/") && strip(path).startsWith(prefix));
  const relative = new Map<string, ArchiveFile>();
  for (const [path, file] of files) relative.set(strip(path).slice(prefix.length), file);
  if (relative.size === 0) throw new ArchiveError(`A pasta "${source.path}" não existe nesse repositório.`);
  return relative;
}
