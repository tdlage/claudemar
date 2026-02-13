import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getAgentPaths } from "./agents/manager.js";
import type { SessionMode } from "./agents/types.js";
import { config } from "./config.js";

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

interface Session {
  activeProject: string | null;
  sessionIds: Record<string, string>;
  busy: boolean;
  mode: SessionMode;
  activeAgent: string | null;
  nextPlanMode: boolean;
}

interface PersistedSession {
  activeProject: string | null;
  sessionIds: Record<string, string>;
  mode: SessionMode;
  activeAgent: string | null;
}

export const sessions = new Map<number, Session>();

function sessionsPath(): string {
  return resolve(config.basePath, "sessions.json");
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 2000;

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistSessions();
  }, PERSIST_DEBOUNCE_MS);
}

function buildSessionData(): Record<string, PersistedSession> {
  const data: Record<string, PersistedSession> = {};
  for (const [chatId, session] of sessions) {
    if (Object.keys(session.sessionIds).length === 0 && !session.activeProject && !session.activeAgent) continue;
    data[String(chatId)] = {
      activeProject: session.activeProject,
      sessionIds: session.sessionIds,
      mode: session.mode,
      activeAgent: session.activeAgent,
    };
  }
  return data;
}

function persistSessions(): void {
  const target = sessionsPath();
  const tmp = target + ".tmp";
  writeFile(tmp, JSON.stringify(buildSessionData(), null, 2), "utf-8")
    .then(() => rename(tmp, target))
    .catch((err) => console.error("[session] persist failed:", err));
}

export function flushSessions(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const target = sessionsPath();
  const tmp = target + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(buildSessionData(), null, 2), "utf-8");
    renameSync(tmp, target);
  } catch (err) {
    console.error("[session] flush failed:", err);
  }
}

function loadPersistedSessions(): void {
  const filePath = sessionsPath();
  if (!existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: Record<string, PersistedSession> = JSON.parse(raw);
    for (const [chatIdStr, persisted] of Object.entries(data)) {
      const chatId = Number(chatIdStr);
      if (Number.isNaN(chatId)) continue;
      sessions.set(chatId, {
        activeProject: persisted.activeProject ?? null,
        sessionIds: persisted.sessionIds ?? {},
        busy: false,
        mode: persisted.mode ?? "projects",
        activeAgent: persisted.activeAgent ?? null,
        nextPlanMode: false,
      });
    }
  } catch {
    // corrupted file, start fresh
  }
}

loadPersistedSessions();

function ensureSession(chatId: number): Session {
  let session = sessions.get(chatId);
  if (!session) {
    session = {
      activeProject: null,
      sessionIds: {},
      busy: false,
      mode: "projects",
      activeAgent: null,
      nextPlanMode: false,
    };
    sessions.set(chatId, session);
  }
  return session;
}

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_RE.test(name);
}

export function safeProjectPath(name: string): string | null {
  if (!isValidProjectName(name)) return null;
  const resolved = resolve(config.projectsPath, name);
  if (!resolved.startsWith(config.projectsPath + sep)) return null;
  return resolved;
}

export function getSession(chatId: number): Session {
  return ensureSession(chatId);
}

export function setActiveProject(
  chatId: number,
  project: string | null,
): void {
  const session = ensureSession(chatId);
  session.activeProject = project;
  schedulePersist();
}

export function getMode(chatId: number): SessionMode {
  return ensureSession(chatId).mode;
}

export function setMode(chatId: number, mode: SessionMode): void {
  const session = ensureSession(chatId);
  session.mode = mode;
  schedulePersist();
}

export function getActiveAgent(chatId: number): string | null {
  return ensureSession(chatId).activeAgent;
}

export function setActiveAgent(chatId: number, agent: string | null): void {
  const session = ensureSession(chatId);
  session.activeAgent = agent;
  schedulePersist();
}

export function getWorkingDirectory(chatId: number): string {
  const session = ensureSession(chatId);

  if (session.mode === "agents" && session.activeAgent) {
    const paths = getAgentPaths(session.activeAgent);
    if (paths) return paths.root;
  }

  if (session.mode === "projects" && session.activeProject) {
    const path = safeProjectPath(session.activeProject);
    if (path) return path;
  }

  return config.orchestratorPath;
}

function sessionKey(session: Session): string {
  if (session.mode === "agents" && session.activeAgent) {
    return `agent:${session.activeAgent}`;
  }
  if (session.mode === "projects" && session.activeProject) {
    return `project:${session.activeProject}`;
  }
  return "orchestrator";
}

export function getSessionId(chatId: number): string | null {
  const session = ensureSession(chatId);
  return session.sessionIds[sessionKey(session)] ?? null;
}

export function setSessionId(chatId: number, id: string): void {
  const session = ensureSession(chatId);
  session.sessionIds[sessionKey(session)] = id;
  schedulePersist();
}

export function resetSessionId(chatId: number): void {
  const session = ensureSession(chatId);
  delete session.sessionIds[sessionKey(session)];
  schedulePersist();
}

export function clearAllSessionIds(chatId: number): void {
  const session = ensureSession(chatId);
  session.sessionIds = {};
  schedulePersist();
}

export function isBusy(chatId: number): boolean {
  return ensureSession(chatId).busy;
}

export function setBusy(chatId: number, busy: boolean): void {
  ensureSession(chatId).busy = busy;
}

export function listProjects(): string[] {
  try {
    const entries = readdirSync(config.projectsPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export interface SessionSnapshot {
  mode: SessionMode;
  activeProject: string | null;
  activeAgent: string | null;
  busy: boolean;
  sessionId: string | null;
}

export function getSessionSnapshot(chatId: number): SessionSnapshot {
  const s = ensureSession(chatId);
  return {
    mode: s.mode,
    activeProject: s.activeProject,
    activeAgent: s.activeAgent,
    busy: s.busy,
    sessionId: s.sessionIds[sessionKey(s)] ?? null,
  };
}

export function setNextPlanMode(chatId: number, value: boolean): void {
  ensureSession(chatId).nextPlanMode = value;
}

export function consumeNextPlanMode(chatId: number): boolean {
  const session = ensureSession(chatId);
  const value = session.nextPlanMode;
  if (value) session.nextPlanMode = false;
  return value;
}
