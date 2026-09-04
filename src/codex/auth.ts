import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { config } from "../config.js";
import { stripCodexCredentials } from "./options.js";

const STATUS_CACHE_MS = 30_000;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 15_000;
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export type CodexAuthMethod = "chatgpt" | "api" | "none";

export interface CodexAuthStatus {
  loggedIn: boolean;
  method: CodexAuthMethod;
  detail: string;
  checkedAt: number;
}

export interface CodexLoginState {
  status: "idle" | "pending" | "done" | "error";
  url: string;
  code: string;
  startedAt: number;
  error: string;
}

const moduleRequire = createRequire(import.meta.url);

// O runtime usa o CLI empacotado pelo Codex SDK (dependência @openai/codex), não um codex
// global da máquina; ambos compartilham as credenciais em CODEX_HOME.
export function resolveCodexBinary(): string {
  const local = resolve(config.installDir, "node_modules", ".bin", "codex");
  if (existsSync(local)) return local;
  const pkg = moduleRequire.resolve("@openai/codex/package.json");
  return resolve(dirname(pkg), "bin", "codex.js");
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME || resolve(homedir(), ".codex");
}

function cliEnv(): NodeJS.ProcessEnv {
  return stripCodexCredentials(process.env);
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function parseLoginStatus(stdout: string, exitCode: number): Omit<CodexAuthStatus, "checkedAt"> {
  const text = stripAnsi(stdout).trim();
  if (/not logged in/i.test(text) || exitCode !== 0) {
    return { loggedIn: false, method: "none", detail: text || "Not logged in" };
  }
  if (/api key/i.test(text)) return { loggedIn: true, method: "api", detail: text };
  if (/chatgpt/i.test(text)) return { loggedIn: true, method: "chatgpt", detail: text };
  return { loggedIn: true, method: "none", detail: text };
}

export function parseDeviceAuthOutput(text: string): { url: string; code: string } {
  const lines = stripAnsi(text).split("\n").map((l) => l.trim());
  let url = "";
  let code = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const urlMatch = line.match(/https?:\/\/\S+/);
    if (urlMatch && !url) url = urlMatch[0];
    if (/one-time code/i.test(line)) {
      const next = lines.slice(i + 1).find((l) => l.length > 0);
      if (next && /^[A-Za-z0-9-]{4,}$/.test(next)) code = next;
    }
  }
  return { url, code };
}

let statusCache: CodexAuthStatus | null = null;

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise) => {
    execFile(resolveCodexBinary(), args, { env: cliEnv(), timeout: COMMAND_TIMEOUT_MS }, (err, stdout, stderr) => {
      const exitCode = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err ? 1 : 0;
      resolvePromise({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), exitCode });
    });
  });
}

export async function getCodexAuthStatus(force = false): Promise<CodexAuthStatus> {
  if (!force && statusCache && Date.now() - statusCache.checkedAt < STATUS_CACHE_MS) return statusCache;
  const { stdout, stderr, exitCode } = await runCli(["login", "status"]);
  const parsed = parseLoginStatus(stdout || stderr, exitCode);
  statusCache = { ...parsed, checkedAt: Date.now() };
  return statusCache;
}

export function invalidateCodexAuthStatus(): void {
  statusCache = null;
}

let loginState: CodexLoginState = { status: "idle", url: "", code: "", startedAt: 0, error: "" };
let loginChild: ChildProcess | null = null;
let loginTimer: ReturnType<typeof setTimeout> | null = null;

function finishLogin(patch: Partial<CodexLoginState>): void {
  if (loginTimer) {
    clearTimeout(loginTimer);
    loginTimer = null;
  }
  loginChild = null;
  loginState = { ...loginState, ...patch };
  invalidateCodexAuthStatus();
}

export function startCodexDeviceLogin(): CodexLoginState {
  if (loginState.status === "pending" && loginChild) return loginState;

  loginState = { status: "pending", url: "", code: "", startedAt: Date.now(), error: "" };
  const child = spawn(resolveCodexBinary(), ["login", "--device-auth"], { env: cliEnv(), stdio: ["ignore", "pipe", "pipe"] });
  loginChild = child;
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf-8");
    const parsed = parseDeviceAuthOutput(stdout);
    if (parsed.url && !loginState.url) loginState = { ...loginState, url: parsed.url };
    if (parsed.code && !loginState.code) loginState = { ...loginState, code: parsed.code };
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });
  child.on("error", (err) => finishLogin({ status: "error", error: err.message }));
  child.on("exit", (code) => {
    if (loginChild !== child) return;
    if (code === 0) {
      finishLogin({ status: "done" });
    } else {
      const detail = stripAnsi(stderr || stdout).trim().split("\n").slice(-3).join(" ");
      finishLogin({ status: "error", error: detail || `codex login terminou com código ${code ?? "desconhecido"}` });
    }
  });

  loginTimer = setTimeout(() => {
    child.kill();
    finishLogin({ status: "error", error: "Tempo esgotado: o código expirou antes de o login ser concluído." });
  }, LOGIN_TIMEOUT_MS);

  return loginState;
}

export function getCodexLoginState(): CodexLoginState {
  return loginState;
}

export function cancelCodexLogin(): CodexLoginState {
  if (loginChild) {
    const child = loginChild;
    loginChild = null;
    child.kill();
  }
  finishLogin({ status: "idle", url: "", code: "", error: "" });
  return loginState;
}

export async function codexLogout(): Promise<void> {
  cancelCodexLogin();
  await runCli(["logout"]);
  invalidateCodexAuthStatus();
}
