import { readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getAgentPaths } from "./agents/manager.js";
import type { SessionMode } from "./agents/types.js";
import { config } from "./config.js";
import { query, execute } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

interface Session {
  activeProject: string | null;
  sessionIds: Record<string, string>;
  busy: boolean;
  mode: SessionMode;
  activeAgent: string | null;
  nextPlanMode: boolean;
}

export const sessions = new Map<number, Session>();

export async function initSessions(): Promise<void> {
  const rows = await query<(RowDataPacket & {
    chat_id: number;
    active_project: string | null;
    session_ids: string;
    mode: SessionMode;
    active_agent: string | null;
  })[]>("SELECT chat_id, active_project, session_ids, mode, active_agent FROM telegram_sessions");

  for (const row of rows) {
    let sessionIds: Record<string, string> = {};
    try {
      sessionIds = typeof row.session_ids === "string" ? JSON.parse(row.session_ids) : (row.session_ids ?? {});
    } catch { }
    sessions.set(row.chat_id, {
      activeProject: row.active_project,
      sessionIds,
      busy: false,
      mode: row.mode ?? "projects",
      activeAgent: row.active_agent,
      nextPlanMode: false,
    });
  }
}

function persistSession(chatId: number, session: Session): void {
  const sessionIds = JSON.stringify(session.sessionIds);
  execute(
    `INSERT INTO telegram_sessions (chat_id, active_project, session_ids, mode, active_agent)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE active_project = VALUES(active_project), session_ids = VALUES(session_ids), mode = VALUES(mode), active_agent = VALUES(active_agent)`,
    [chatId, session.activeProject ?? null, sessionIds, session.mode, session.activeAgent ?? null],
  ).catch((err) => console.error("[session] persist failed:", err));
}

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

export function setActiveProject(chatId: number, project: string | null): void {
  const session = ensureSession(chatId);
  session.activeProject = project;
  persistSession(chatId, session);
}

export function getMode(chatId: number): SessionMode {
  return ensureSession(chatId).mode;
}

export function setMode(chatId: number, mode: SessionMode): void {
  const session = ensureSession(chatId);
  session.mode = mode;
  persistSession(chatId, session);
}

export function getActiveAgent(chatId: number): string | null {
  return ensureSession(chatId).activeAgent;
}

export function setActiveAgent(chatId: number, agent: string | null): void {
  const session = ensureSession(chatId);
  session.activeAgent = agent;
  persistSession(chatId, session);
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
  persistSession(chatId, session);
}

export function resetSessionId(chatId: number): void {
  const session = ensureSession(chatId);
  delete session.sessionIds[sessionKey(session)];
  persistSession(chatId, session);
}

export function clearAllSessionIds(chatId: number): void {
  const session = ensureSession(chatId);
  session.sessionIds = {};
  persistSession(chatId, session);
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
