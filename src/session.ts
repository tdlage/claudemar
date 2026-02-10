import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getAgentPaths } from "./agents/manager.js";
import type { SessionMode } from "./agents/types.js";
import { config } from "./config.js";

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

interface Session {
  activeProject: string | null;
  sessionId: string | null;
  busy: boolean;
  mode: SessionMode;
  activeAgent: string | null;
}

export const sessions = new Map<number, Session>();

function ensureSession(chatId: number): Session {
  let session = sessions.get(chatId);
  if (!session) {
    session = {
      activeProject: null,
      sessionId: null,
      busy: false,
      mode: "projects",
      activeAgent: null,
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
  session.sessionId = null;
}

export function getMode(chatId: number): SessionMode {
  return ensureSession(chatId).mode;
}

export function setMode(chatId: number, mode: SessionMode): void {
  const session = ensureSession(chatId);
  session.mode = mode;
  session.sessionId = null;
}

export function getActiveAgent(chatId: number): string | null {
  return ensureSession(chatId).activeAgent;
}

export function setActiveAgent(chatId: number, agent: string | null): void {
  const session = ensureSession(chatId);
  session.activeAgent = agent;
  session.sessionId = null;
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

export function getSessionId(chatId: number): string | null {
  return ensureSession(chatId).sessionId;
}

export function setSessionId(chatId: number, id: string): void {
  ensureSession(chatId).sessionId = id;
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
    sessionId: s.sessionId,
  };
}
