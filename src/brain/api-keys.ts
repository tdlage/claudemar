import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { ADMIN_BRAIN, isBrainOwnerId, type BrainScope } from "./scope.js";

const KEY_PREFIX = "cmb_";
const KEY_PATTERN = /^cmb_[A-Za-z0-9_-]{43}$/;
const LAST_USED_RESOLUTION_MS = 60_000;
const KEYS_PATH = resolve(config.dataPath, "brain-api-keys.json");
const FILE_MODE = 0o600;

export interface BrainApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface StoredKey extends BrainApiKeyInfo {
  hash: string;
  owner: string;
}

export interface AuthenticatedBrainKey {
  info: BrainApiKeyInfo;
  owner: string;
}

export interface BrainMcpAuditEntry {
  at: string;
  keyId: string;
  keyName: string;
  ip: string;
  userAgent: string;
  tool: string;
  args: string;
  bytes: number;
  ok: boolean;
}

function digest(key: string): Buffer {
  return createHash("sha256").update(key, "utf-8").digest();
}

const AUDIT_TAIL_BYTES = 512 * 1024;

function parseStored(): unknown {
  try {
    return JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
  } catch (err) {
    console.error("[brain:api-keys] arquivo de chaves ilegível — nenhuma chave aceita:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/** Chaves anteriores ao brain por usuário não têm dono gravado: eram todas do admin. */
function load(): StoredKey[] {
  if (!existsSync(KEYS_PATH)) return [];
  const raw = parseStored();
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is StoredKey => {
      const e = entry as Partial<StoredKey> | null;
      return Boolean(
        e &&
          typeof e.id === "string" &&
          typeof e.name === "string" &&
          typeof e.prefix === "string" &&
          typeof e.hash === "string" &&
          /^[0-9a-f]{64}$/.test(e.hash) &&
          typeof e.createdAt === "string" &&
          (e.owner === undefined || isBrainOwnerId(e.owner)),
      );
    })
    .map((e) => ({
      ...e,
      owner: e.owner ?? ADMIN_BRAIN,
      lastUsedAt: typeof e.lastUsedAt === "string" ? e.lastUsedAt : null,
    }));
}

function info(key: StoredKey): BrainApiKeyInfo {
  return { id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt };
}

/** Chaves de leitura do Second Brain para agentes externos; só o hash é persistido, sempre de forma síncrona. */
class BrainApiKeys {
  private keys: StoredKey[] = load();

  private save(next: StoredKey[]): void {
    const tmp = `${KEYS_PATH}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: FILE_MODE });
    renameSync(tmp, KEYS_PATH);
    this.keys = next;
  }

  list(owner: string): BrainApiKeyInfo[] {
    return this.keys.filter((k) => k.owner === owner).map(info);
  }

  create(owner: string, name: string): { key: string; info: BrainApiKeyInfo } {
    if (!isBrainOwnerId(owner)) throw new Error("dono de brain inválido");
    const label = name.trim().slice(0, 80);
    if (!label) throw new Error("nome da chave é obrigatório");
    const secret = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const stored: StoredKey = {
      id: randomUUID(),
      name: label,
      prefix: secret.slice(0, KEY_PREFIX.length + 6),
      hash: digest(secret).toString("hex"),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      owner,
    };
    this.save([...this.keys, stored]);
    return { key: secret, info: info(stored) };
  }

  revoke(owner: string, id: string): boolean {
    const next = this.keys.filter((k) => !(k.id === id && k.owner === owner));
    if (next.length === this.keys.length) return false;
    this.save(next);
    return true;
  }

  revokeAll(owner: string): number {
    const next = this.keys.filter((k) => k.owner !== owner);
    const removed = this.keys.length - next.length;
    if (removed > 0) this.save(next);
    return removed;
  }

  authenticate(candidate: string): AuthenticatedBrainKey | null {
    if (!KEY_PATTERN.test(candidate)) return null;
    const hashed = digest(candidate);
    const match = this.keys.find((k) => timingSafeEqual(Buffer.from(k.hash, "hex"), hashed));
    if (!match) return null;
    const now = Date.now();
    if (!match.lastUsedAt || now - Date.parse(match.lastUsedAt) > LAST_USED_RESOLUTION_MS) {
      const lastUsedAt = new Date(now).toISOString();
      try {
        this.save(this.keys.map((k) => (k.id === match.id ? { ...k, lastUsedAt } : k)));
      } catch (err) {
        console.error("[brain:api-keys] falha ao registrar uso:", err instanceof Error ? err.message : String(err));
      }
    }
    return { info: info(this.keys.find((k) => k.id === match.id) ?? match), owner: match.owner };
  }

  audit(scope: BrainScope, entry: BrainMcpAuditEntry): void {
    try {
      appendFileSync(scope.mcpAuditFile, `${JSON.stringify(entry)}\n`, { encoding: "utf-8", mode: FILE_MODE });
    } catch (err) {
      console.error("[brain:api-keys] falha na auditoria:", err instanceof Error ? err.message : String(err));
    }
  }

  readAudit(scope: BrainScope, limit: number): BrainMcpAuditEntry[] {
    if (!existsSync(scope.mcpAuditFile)) return [];
    const fd = openSync(scope.mcpAuditFile, "r");
    let lines: string[];
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, AUDIT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      lines = buffer.toString("utf-8").trimEnd().split("\n");
      if (size > length) lines.shift();
    } finally {
      closeSync(fd);
    }
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as BrainMcpAuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is BrainMcpAuditEntry => e !== null)
      .reverse();
  }
}

export const brainApiKeys = new BrainApiKeys();
