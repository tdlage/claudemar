import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { query, execute } from "./database.js";
import { config } from "./config.js";
import type { RowDataPacket } from "mysql2/promise";

const UPLOADS_DIR = resolve(config.dataPath, "tracker-uploads");

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  return map[mime] || ".bin";
}

function ensureUploadsDir(): void {
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
}

function saveUploadFile(base64: string, mimeType: string): { id: string; size: number; filename: string } {
  ensureUploadsDir();
  const id = randomUUID();
  const ext = mimeToExt(mimeType);
  const filename = `${id}${ext}`;
  const buffer = Buffer.from(base64, "base64");
  writeFileSync(resolve(UPLOADS_DIR, filename), buffer);
  return { id, size: buffer.length, filename };
}

function validateMedia(mimeType: string, size: number): void {
  const isImage = ALLOWED_IMAGE_TYPES.has(mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(mimeType);
  if (!isImage && !isVideo) throw new Error(`Unsupported media type: ${mimeType}`);
  if (isImage && size > MAX_IMAGE_SIZE) throw new Error("Image exceeds 10MB limit");
  if (isVideo && size > MAX_VIDEO_SIZE) throw new Error("Video exceeds 100MB limit");
}

// ── Types ──

export interface TrackerCycle {
  id: string;
  name: string;
  status: "shaping" | "betting" | "building" | "cooldown" | "completed";
  startDate: string;
  endDate: string;
  cooldownEndDate: string;
  createdBy: string;
  createdAt: string;
}

export interface TrackerBet {
  id: string;
  cycleId: string;
  title: string;
  description: string;
  status: "pitch" | "bet" | "in_progress" | "done" | "dropped";
  appetite: "small" | "big";
  projectName: string;
  assignees: string[];
  tags: string[];
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerScope {
  id: string;
  betId: string;
  title: string;
  description: string;
  status: "uphill" | "overhill" | "done";
  hillPosition: number;
  assignees: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerComment {
  id: string;
  targetType: "bet" | "scope";
  targetId: string;
  authorId: string;
  authorName: string;
  content: string;
  attachments: TrackerAttachment[];
  createdAt: string;
}

export interface TrackerAttachment {
  id: string;
  commentId: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TrackerCommitLink {
  id: string;
  scopeId: string;
  projectName: string;
  repoName: string;
  commitHash: string;
  commitMessage: string;
  linkedAt: string;
  linkedBy: string;
}

export interface TrackerTestCase {
  id: string;
  targetType: "bet" | "scope";
  targetId: string;
  title: string;
  description: string;
  preconditions: string;
  steps: string;
  expectedResult: string;
  priority: "critical" | "high" | "medium" | "low";
  position: number;
  lastRunStatus: string | null;
  passCount: number;
  failCount: number;
  totalRuns: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerTestRun {
  id: string;
  testCaseId: string;
  status: "passed" | "failed" | "blocked" | "skipped";
  notes: string;
  executedBy: string;
  executedByName: string;
  executedAt: string;
  durationSeconds: number | null;
  attachments: TrackerTestRunAttachment[];
}

export interface TrackerTestRunAttachment {
  id: string;
  testRunId: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TrackerTestRunComment {
  id: string;
  testRunId: string;
  authorId: string;
  authorName: string;
  content: string;
  attachments: TrackerTestRunCommentAttachment[];
  createdAt: string;
}

export interface TrackerTestRunCommentAttachment {
  id: string;
  commentId: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

// ── Row types ──

interface CycleRow extends RowDataPacket {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  cooldown_end_date: string;
  created_by: string;
  created_at: string;
}

interface BetRow extends RowDataPacket {
  id: string;
  cycle_id: string;
  title: string;
  description: string | null;
  status: string;
  appetite: string;
  project_name: string | null;
  tags: string | null;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ScopeRow extends RowDataPacket {
  id: string;
  bet_id: string;
  title: string;
  description: string | null;
  status: string;
  hill_position: number;
  position: number;
  created_at: string;
  updated_at: string;
}

interface AssigneeRow extends RowDataPacket {
  bet_id?: string;
  scope_id?: string;
  user_id: string;
}

interface CommentRow extends RowDataPacket {
  id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

interface AttachmentRow extends RowDataPacket {
  id: string;
  comment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  uploaded_at: string;
}

interface CommitLinkRow extends RowDataPacket {
  id: string;
  scope_id: string;
  project_name: string;
  repo_name: string;
  commit_hash: string;
  commit_message: string | null;
  linked_at: string;
  linked_by: string;
}

interface TestCaseRow extends RowDataPacket {
  id: string;
  target_type: string;
  target_id: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  steps: string | null;
  expected_result: string | null;
  priority: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_run_status: string | null;
  pass_count: number;
  fail_count: number;
  total_runs: number;
}

interface TestRunRow extends RowDataPacket {
  id: string;
  test_case_id: string;
  status: string;
  notes: string | null;
  executed_by: string;
  executed_by_name: string;
  executed_at: string;
  duration_seconds: number | null;
}

interface TestRunAttachmentRow extends RowDataPacket {
  id: string;
  test_run_id: string;
  filename: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  uploaded_at: string;
}

interface TestRunCommentRow extends RowDataPacket {
  id: string;
  test_run_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

interface TestRunCommentAttachmentRow extends RowDataPacket {
  id: string;
  comment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  uploaded_at: string;
}

// ── Mappers ──

function mapCycle(r: CycleRow): TrackerCycle {
  return {
    id: r.id,
    name: r.name,
    status: r.status as TrackerCycle["status"],
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    cooldownEndDate: String(r.cooldown_end_date).slice(0, 10),
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapBet(r: BetRow, assignees: string[]): TrackerBet {
  let tags: string[] = [];
  if (r.tags) {
    try { tags = typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags; } catch { /* empty */ }
  }
  return {
    id: r.id,
    cycleId: r.cycle_id,
    title: r.title,
    description: r.description || "",
    status: r.status as TrackerBet["status"],
    appetite: r.appetite as TrackerBet["appetite"],
    projectName: r.project_name || "",
    assignees,
    tags,
    position: r.position,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapScope(r: ScopeRow, assignees: string[]): TrackerScope {
  return {
    id: r.id,
    betId: r.bet_id,
    title: r.title,
    description: r.description || "",
    status: r.status as TrackerScope["status"],
    hillPosition: r.hill_position,
    assignees,
    position: r.position,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapComment(r: CommentRow, attachments: TrackerAttachment[]): TrackerComment {
  return {
    id: r.id,
    targetType: r.target_type as TrackerComment["targetType"],
    targetId: r.target_id,
    authorId: r.author_id,
    authorName: r.author_name,
    content: r.content,
    attachments,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapAttachment(r: AttachmentRow): TrackerAttachment {
  return {
    id: r.id,
    commentId: r.comment_id,
    filename: r.filename,
    mimeType: r.mime_type,
    size: r.size,
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

function mapCommitLink(r: CommitLinkRow): TrackerCommitLink {
  return {
    id: r.id,
    scopeId: r.scope_id,
    projectName: r.project_name,
    repoName: r.repo_name,
    commitHash: r.commit_hash,
    commitMessage: r.commit_message || "",
    linkedAt: new Date(r.linked_at).toISOString(),
    linkedBy: r.linked_by,
  };
}

function mapTestCase(r: TestCaseRow): TrackerTestCase {
  return {
    id: r.id,
    targetType: r.target_type as TrackerTestCase["targetType"],
    targetId: r.target_id,
    title: r.title,
    description: r.description || "",
    preconditions: r.preconditions || "",
    steps: r.steps || "",
    expectedResult: r.expected_result || "",
    priority: r.priority as TrackerTestCase["priority"],
    position: r.position,
    lastRunStatus: r.last_run_status || null,
    passCount: Number(r.pass_count) || 0,
    failCount: Number(r.fail_count) || 0,
    totalRuns: Number(r.total_runs) || 0,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapTestRun(r: TestRunRow, attachments: TrackerTestRunAttachment[]): TrackerTestRun {
  return {
    id: r.id,
    testCaseId: r.test_case_id,
    status: r.status as TrackerTestRun["status"],
    notes: r.notes || "",
    executedBy: r.executed_by,
    executedByName: r.executed_by_name,
    executedAt: new Date(r.executed_at).toISOString(),
    durationSeconds: r.duration_seconds,
    attachments,
  };
}

function mapTestRunAttachment(r: TestRunAttachmentRow): TrackerTestRunAttachment {
  return {
    id: r.id,
    testRunId: r.test_run_id,
    filename: r.filename,
    mimeType: r.mime_type,
    size: Number(r.size),
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

function mapTestRunComment(r: TestRunCommentRow, attachments: TrackerTestRunCommentAttachment[]): TrackerTestRunComment {
  return {
    id: r.id,
    testRunId: r.test_run_id,
    authorId: r.author_id,
    authorName: r.author_name,
    content: r.content,
    attachments,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapTestRunCommentAttachment(r: TestRunCommentAttachmentRow): TrackerTestRunCommentAttachment {
  return {
    id: r.id,
    commentId: r.comment_id,
    filename: r.filename,
    mimeType: r.mime_type,
    size: Number(r.size),
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

// ── Manager ──

class TrackerManager extends EventEmitter {

  // ── Cycles ──

  async getCycles(): Promise<TrackerCycle[]> {
    const rows = await query<CycleRow[]>("SELECT * FROM tracker_cycles ORDER BY start_date DESC");
    return rows.map(mapCycle);
  }

  async getCycle(id: string): Promise<TrackerCycle | null> {
    const rows = await query<CycleRow[]>("SELECT * FROM tracker_cycles WHERE id = ?", [id]);
    return rows[0] ? mapCycle(rows[0]) : null;
  }

  async createCycle(data: { name: string; startDate: string; endDate: string; cooldownEndDate: string; createdBy: string }): Promise<TrackerCycle> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_cycles (id, name, start_date, end_date, cooldown_end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.name, data.startDate, data.endDate, data.cooldownEndDate, data.createdBy],
    );
    const cycle = (await this.getCycle(id))!;
    this.emit("cycle:create", cycle);
    return cycle;
  }

  async updateCycle(id: string, data: Partial<{ name: string; status: string; startDate: string; endDate: string; cooldownEndDate: string }>): Promise<TrackerCycle | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); params.push(data.name); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (data.startDate !== undefined) { sets.push("start_date = ?"); params.push(data.startDate); }
    if (data.endDate !== undefined) { sets.push("end_date = ?"); params.push(data.endDate); }
    if (data.cooldownEndDate !== undefined) { sets.push("cooldown_end_date = ?"); params.push(data.cooldownEndDate); }
    if (sets.length === 0) return this.getCycle(id);
    params.push(id);
    await execute(`UPDATE tracker_cycles SET ${sets.join(", ")} WHERE id = ?`, params);
    const cycle = await this.getCycle(id);
    if (cycle) this.emit("cycle:update", cycle);
    return cycle;
  }

  async deleteCycle(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_cycles WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("cycle:delete", { id });
      return true;
    }
    return false;
  }

  // ── Bets ──

  private async getBetAssignees(betIds: string[]): Promise<Map<string, string[]>> {
    if (betIds.length === 0) return new Map();
    const placeholders = betIds.map(() => "?").join(",");
    const rows = await query<AssigneeRow[]>(`SELECT bet_id, user_id FROM tracker_bet_assignees WHERE bet_id IN (${placeholders})`, betIds);
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.bet_id!) || [];
      list.push(r.user_id);
      map.set(r.bet_id!, list);
    }
    return map;
  }

  async getBetsByCycle(cycleId: string): Promise<TrackerBet[]> {
    const rows = await query<BetRow[]>("SELECT * FROM tracker_bets WHERE cycle_id = ? ORDER BY position, created_at", [cycleId]);
    const assigneesMap = await this.getBetAssignees(rows.map((r) => r.id));
    return rows.map((r) => mapBet(r, assigneesMap.get(r.id) || []));
  }

  async getBet(id: string): Promise<TrackerBet | null> {
    const rows = await query<BetRow[]>("SELECT * FROM tracker_bets WHERE id = ?", [id]);
    if (!rows[0]) return null;
    const assigneesMap = await this.getBetAssignees([id]);
    return mapBet(rows[0], assigneesMap.get(id) || []);
  }

  async createBet(data: {
    cycleId: string; title: string; description?: string; appetite?: string;
    projectName?: string; assignees?: string[]; tags?: string[]; createdBy: string;
  }): Promise<TrackerBet> {
    const id = randomUUID();
    const maxPos = await query<RowDataPacket[]>("SELECT COALESCE(MAX(position), -1) AS mp FROM tracker_bets WHERE cycle_id = ?", [data.cycleId]);
    const position = (maxPos[0]?.mp ?? -1) + 1;
    await execute(
      "INSERT INTO tracker_bets (id, cycle_id, title, description, appetite, project_name, tags, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.cycleId, data.title, data.description || "", data.appetite || "small", data.projectName || "", JSON.stringify(data.tags || []), position, data.createdBy],
    );
    if (data.assignees?.length) {
      await execute(`INSERT INTO tracker_bet_assignees (bet_id, user_id) VALUES ${data.assignees.map(() => "(?, ?)").join(",")}`,
        data.assignees.flatMap((uid) => [id, uid]));
    }
    const bet = (await this.getBet(id))!;
    this.emit("bet:create", bet);
    return bet;
  }

  async updateBet(id: string, data: Partial<{
    title: string; description: string; status: string; appetite: string;
    projectName: string; assignees: string[]; tags: string[];
  }>): Promise<TrackerBet | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.title !== undefined) { sets.push("title = ?"); params.push(data.title); }
    if (data.description !== undefined) { sets.push("description = ?"); params.push(data.description); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (data.appetite !== undefined) { sets.push("appetite = ?"); params.push(data.appetite); }
    if (data.projectName !== undefined) { sets.push("project_name = ?"); params.push(data.projectName); }
    if (data.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(data.tags)); }
    if (sets.length > 0) {
      params.push(id);
      await execute(`UPDATE tracker_bets SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    if (data.assignees !== undefined) {
      await execute("DELETE FROM tracker_bet_assignees WHERE bet_id = ?", [id]);
      if (data.assignees.length > 0) {
        await execute(
          `INSERT INTO tracker_bet_assignees (bet_id, user_id) VALUES ${data.assignees.map(() => "(?, ?)").join(",")}`,
          data.assignees.flatMap((uid) => [id, uid]),
        );
      }
    }
    const bet = await this.getBet(id);
    if (bet) this.emit("bet:update", bet);
    return bet;
  }

  async moveBet(id: string, status: string, position: number): Promise<TrackerBet | null> {
    await execute("UPDATE tracker_bets SET status = ?, position = ? WHERE id = ?", [status, position, id]);
    const bet = await this.getBet(id);
    if (bet) this.emit("bet:update", bet);
    return bet;
  }

  async deleteBet(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_bets WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("bet:delete", { id });
      return true;
    }
    return false;
  }

  // ── Scopes ──

  private async getScopeAssignees(scopeIds: string[]): Promise<Map<string, string[]>> {
    if (scopeIds.length === 0) return new Map();
    const placeholders = scopeIds.map(() => "?").join(",");
    const rows = await query<AssigneeRow[]>(`SELECT scope_id, user_id FROM tracker_scope_assignees WHERE scope_id IN (${placeholders})`, scopeIds);
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.scope_id!) || [];
      list.push(r.user_id);
      map.set(r.scope_id!, list);
    }
    return map;
  }

  async getScopesByBet(betId: string): Promise<TrackerScope[]> {
    const rows = await query<ScopeRow[]>("SELECT * FROM tracker_scopes WHERE bet_id = ? ORDER BY position, created_at", [betId]);
    const assigneesMap = await this.getScopeAssignees(rows.map((r) => r.id));
    return rows.map((r) => mapScope(r, assigneesMap.get(r.id) || []));
  }

  async getScope(id: string): Promise<TrackerScope | null> {
    const rows = await query<ScopeRow[]>("SELECT * FROM tracker_scopes WHERE id = ?", [id]);
    if (!rows[0]) return null;
    const assigneesMap = await this.getScopeAssignees([id]);
    return mapScope(rows[0], assigneesMap.get(id) || []);
  }

  async createScope(data: { betId: string; title: string; description?: string; assignees?: string[] }): Promise<TrackerScope> {
    const id = randomUUID();
    const maxPos = await query<RowDataPacket[]>("SELECT COALESCE(MAX(position), -1) AS mp FROM tracker_scopes WHERE bet_id = ?", [data.betId]);
    const position = (maxPos[0]?.mp ?? -1) + 1;
    await execute(
      "INSERT INTO tracker_scopes (id, bet_id, title, description, position) VALUES (?, ?, ?, ?, ?)",
      [id, data.betId, data.title, data.description || "", position],
    );
    if (data.assignees?.length) {
      await execute(
        `INSERT INTO tracker_scope_assignees (scope_id, user_id) VALUES ${data.assignees.map(() => "(?, ?)").join(",")}`,
        data.assignees.flatMap((uid) => [id, uid]),
      );
    }
    const scope = (await this.getScope(id))!;
    this.emit("scope:create", scope);
    return scope;
  }

  async updateScope(id: string, data: Partial<{ title: string; description: string; status: string; assignees: string[] }>): Promise<TrackerScope | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.title !== undefined) { sets.push("title = ?"); params.push(data.title); }
    if (data.description !== undefined) { sets.push("description = ?"); params.push(data.description); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (sets.length > 0) {
      params.push(id);
      await execute(`UPDATE tracker_scopes SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    if (data.assignees !== undefined) {
      await execute("DELETE FROM tracker_scope_assignees WHERE scope_id = ?", [id]);
      if (data.assignees.length > 0) {
        await execute(
          `INSERT INTO tracker_scope_assignees (scope_id, user_id) VALUES ${data.assignees.map(() => "(?, ?)").join(",")}`,
          data.assignees.flatMap((uid) => [id, uid]),
        );
      }
    }
    const scope = await this.getScope(id);
    if (scope) this.emit("scope:update", scope);
    return scope;
  }

  async updateHillPosition(id: string, hillPosition: number): Promise<TrackerScope | null> {
    const parsed = Number(hillPosition);
    if (isNaN(parsed)) return this.getScope(id);
    const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
    await execute("UPDATE tracker_scopes SET hill_position = ? WHERE id = ?", [clamped, id]);
    const scope = await this.getScope(id);
    if (scope) this.emit("scope:update", scope);
    return scope;
  }

  async deleteScope(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_scopes WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("scope:delete", { id });
      return true;
    }
    return false;
  }

  // ── Comments ──

  async getComments(targetType: string, targetId: string): Promise<TrackerComment[]> {
    const rows = await query<CommentRow[]>(
      "SELECT * FROM tracker_comments WHERE target_type = ? AND target_id = ? ORDER BY created_at",
      [targetType, targetId],
    );
    if (rows.length === 0) return [];
    const commentIds = rows.map((r) => r.id);
    const placeholders = commentIds.map(() => "?").join(",");
    const attachRows = await query<AttachmentRow[]>(
      `SELECT * FROM tracker_attachments WHERE comment_id IN (${placeholders}) ORDER BY uploaded_at`,
      commentIds,
    );
    const attachMap = new Map<string, TrackerAttachment[]>();
    for (const a of attachRows) {
      const list = attachMap.get(a.comment_id) || [];
      list.push(mapAttachment(a));
      attachMap.set(a.comment_id, list);
    }
    return rows.map((r) => mapComment(r, attachMap.get(r.id) || []));
  }

  async addComment(data: {
    targetType: string; targetId: string; authorId: string; authorName: string; content: string;
    attachments?: Array<{ base64: string; filename: string; mimeType: string }>;
  }): Promise<TrackerComment> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_comments (id, target_type, target_id, author_id, author_name, content) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.targetType, data.targetId, data.authorId, data.authorName, data.content],
    );
    const savedAttachments: TrackerAttachment[] = [];
    if (data.attachments?.length) {
      for (const att of data.attachments) {
        const buf = Buffer.from(att.base64, "base64");
        validateMedia(att.mimeType, buf.length);
        const file = saveUploadFile(att.base64, att.mimeType);
        const attId = file.id;
        await execute(
          "INSERT INTO tracker_attachments (id, comment_id, filename, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
          [attId, id, file.filename, att.mimeType, file.size, data.authorId],
        );
        savedAttachments.push({
          id: attId, commentId: id, filename: file.filename,
          mimeType: att.mimeType, size: file.size,
          uploadedBy: data.authorId, uploadedAt: new Date().toISOString(),
        });
      }
    }
    const comment: TrackerComment = {
      id, targetType: data.targetType as TrackerComment["targetType"],
      targetId: data.targetId, authorId: data.authorId,
      authorName: data.authorName, content: data.content,
      attachments: savedAttachments, createdAt: new Date().toISOString(),
    };
    this.emit("comment:add", comment);
    return comment;
  }

  async deleteComment(id: string): Promise<boolean> {
    const attachRows = await query<AttachmentRow[]>("SELECT * FROM tracker_attachments WHERE comment_id = ?", [id]);
    for (const a of attachRows) {
      const path = resolve(UPLOADS_DIR, a.filename);
      if (existsSync(path)) unlinkSync(path);
    }
    const result = await execute("DELETE FROM tracker_comments WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("comment:delete", { id });
      return true;
    }
    return false;
  }

  getUploadPath(filename: string): string | null {
    const path = resolve(UPLOADS_DIR, filename);
    if (!path.startsWith(UPLOADS_DIR)) return null;
    if (!existsSync(path)) return null;
    return path;
  }

  // ── Commit Links ──

  async linkCommit(data: {
    scopeId: string; projectName: string; repoName: string;
    commitHash: string; commitMessage?: string; linkedBy: string;
  }): Promise<TrackerCommitLink> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_commit_links (id, scope_id, project_name, repo_name, commit_hash, commit_message, linked_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, data.scopeId, data.projectName, data.repoName, data.commitHash, data.commitMessage || "", data.linkedBy],
    );
    const link: TrackerCommitLink = {
      id, scopeId: data.scopeId, projectName: data.projectName,
      repoName: data.repoName, commitHash: data.commitHash,
      commitMessage: data.commitMessage || "",
      linkedAt: new Date().toISOString(), linkedBy: data.linkedBy,
    };
    this.emit("commit:link", link);
    return link;
  }

  async unlinkCommit(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_commit_links WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("commit:unlink", { id });
      return true;
    }
    return false;
  }

  async getCommitsByScope(scopeId: string): Promise<TrackerCommitLink[]> {
    const rows = await query<CommitLinkRow[]>("SELECT * FROM tracker_commit_links WHERE scope_id = ? ORDER BY linked_at DESC", [scopeId]);
    return rows.map(mapCommitLink);
  }

  async getScopeByCommit(projectName: string, repoName: string, commitHash: string): Promise<TrackerScope | null> {
    const rows = await query<CommitLinkRow[]>(
      "SELECT * FROM tracker_commit_links WHERE project_name = ? AND repo_name = ? AND commit_hash = ?",
      [projectName, repoName, commitHash],
    );
    if (!rows[0]) return null;
    return this.getScope(rows[0].scope_id);
  }

  // ── Test Cases ──

  async getTestCases(targetType: string, targetId: string): Promise<TrackerTestCase[]> {
    const rows = await query<TestCaseRow[]>(`
      SELECT tc.*,
        (SELECT tr.status FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id ORDER BY tr.executed_at DESC LIMIT 1) AS last_run_status,
        (SELECT COUNT(*) FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id AND tr.status = 'passed') AS pass_count,
        (SELECT COUNT(*) FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id AND tr.status = 'failed') AS fail_count,
        (SELECT COUNT(*) FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id) AS total_runs
      FROM tracker_test_cases tc
      WHERE tc.target_type = ? AND tc.target_id = ?
      ORDER BY tc.position, tc.created_at
    `, [targetType, targetId]);
    return rows.map(mapTestCase);
  }

  async getTestCase(id: string): Promise<TrackerTestCase | null> {
    const rows = await query<TestCaseRow[]>(`
      SELECT tc.*,
        (SELECT tr.status FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id ORDER BY tr.executed_at DESC LIMIT 1) AS last_run_status,
        (SELECT COUNT(*) FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id AND tr.status = 'passed') AS pass_count,
        (SELECT COUNT(*) FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id AND tr.status = 'failed') AS fail_count,
        (SELECT COUNT(*) FROM tracker_test_runs tr WHERE tr.test_case_id = tc.id) AS total_runs
      FROM tracker_test_cases tc WHERE tc.id = ?
    `, [id]);
    return rows[0] ? mapTestCase(rows[0]) : null;
  }

  async createTestCase(data: {
    targetType: string; targetId: string; title: string; description?: string;
    preconditions?: string; steps?: string; expectedResult?: string;
    priority?: string; createdBy: string;
  }): Promise<TrackerTestCase> {
    const id = randomUUID();
    const maxPos = await query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(position), -1) AS mp FROM tracker_test_cases WHERE target_type = ? AND target_id = ?",
      [data.targetType, data.targetId],
    );
    const position = (maxPos[0]?.mp ?? -1) + 1;
    await execute(
      "INSERT INTO tracker_test_cases (id, target_type, target_id, title, description, preconditions, steps, expected_result, priority, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.targetType, data.targetId, data.title, data.description || "", data.preconditions || "", data.steps || "", data.expectedResult || "", data.priority || "medium", position, data.createdBy],
    );
    const tc = (await this.getTestCase(id))!;
    this.emit("testcase:create", tc);
    return tc;
  }

  async updateTestCase(id: string, data: Partial<{
    title: string; description: string; preconditions: string;
    steps: string; expectedResult: string; priority: string;
  }>): Promise<TrackerTestCase | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.title !== undefined) { sets.push("title = ?"); params.push(data.title); }
    if (data.description !== undefined) { sets.push("description = ?"); params.push(data.description); }
    if (data.preconditions !== undefined) { sets.push("preconditions = ?"); params.push(data.preconditions); }
    if (data.steps !== undefined) { sets.push("steps = ?"); params.push(data.steps); }
    if (data.expectedResult !== undefined) { sets.push("expected_result = ?"); params.push(data.expectedResult); }
    if (data.priority !== undefined) { sets.push("priority = ?"); params.push(data.priority); }
    if (sets.length === 0) return this.getTestCase(id);
    params.push(id);
    await execute(`UPDATE tracker_test_cases SET ${sets.join(", ")} WHERE id = ?`, params);
    const tc = await this.getTestCase(id);
    if (tc) this.emit("testcase:update", tc);
    return tc;
  }

  async deleteTestCase(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_test_cases WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("testcase:delete", { id });
      return true;
    }
    return false;
  }

  async reorderTestCases(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await execute("UPDATE tracker_test_cases SET position = ? WHERE id = ?", [i, ids[i]]);
    }
    this.emit("testcase:reorder", { ids });
  }

  // ── Test Runs ──

  async getTestRuns(testCaseId: string): Promise<TrackerTestRun[]> {
    const rows = await query<TestRunRow[]>(
      "SELECT * FROM tracker_test_runs WHERE test_case_id = ? ORDER BY executed_at DESC",
      [testCaseId],
    );
    if (rows.length === 0) return [];
    const runIds = rows.map((r) => r.id);
    const placeholders = runIds.map(() => "?").join(",");
    const attachRows = await query<TestRunAttachmentRow[]>(
      `SELECT * FROM tracker_test_run_attachments WHERE test_run_id IN (${placeholders}) ORDER BY uploaded_at`,
      runIds,
    );
    const attachMap = new Map<string, TrackerTestRunAttachment[]>();
    for (const a of attachRows) {
      const list = attachMap.get(a.test_run_id) || [];
      list.push(mapTestRunAttachment(a));
      attachMap.set(a.test_run_id, list);
    }
    return rows.map((r) => mapTestRun(r, attachMap.get(r.id) || []));
  }

  async getTestRun(id: string): Promise<TrackerTestRun | null> {
    const rows = await query<TestRunRow[]>("SELECT * FROM tracker_test_runs WHERE id = ?", [id]);
    if (!rows[0]) return null;
    const attachRows = await query<TestRunAttachmentRow[]>(
      "SELECT * FROM tracker_test_run_attachments WHERE test_run_id = ? ORDER BY uploaded_at", [id],
    );
    return mapTestRun(rows[0], attachRows.map(mapTestRunAttachment));
  }

  async createTestRun(data: {
    testCaseId: string; status: string; notes?: string;
    executedBy: string; executedByName: string; durationSeconds?: number;
    attachments?: Array<{ base64: string; filename: string; mimeType: string }>;
  }): Promise<TrackerTestRun> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_test_runs (id, test_case_id, status, notes, executed_by, executed_by_name, duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, data.testCaseId, data.status, data.notes || "", data.executedBy, data.executedByName, data.durationSeconds ?? null],
    );
    const savedAttachments: TrackerTestRunAttachment[] = [];
    if (data.attachments?.length) {
      for (const att of data.attachments) {
        const buf = Buffer.from(att.base64, "base64");
        validateMedia(att.mimeType, buf.length);
        const file = saveUploadFile(att.base64, att.mimeType);
        await execute(
          "INSERT INTO tracker_test_run_attachments (id, test_run_id, filename, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
          [file.id, id, file.filename, att.mimeType, file.size, data.executedBy],
        );
        savedAttachments.push({
          id: file.id, testRunId: id, filename: file.filename,
          mimeType: att.mimeType, size: file.size,
          uploadedBy: data.executedBy, uploadedAt: new Date().toISOString(),
        });
      }
    }
    const run = (await this.getTestRun(id))!;
    this.emit("testrun:create", run);
    const tc = await this.getTestCase(data.testCaseId);
    if (tc) this.emit("testcase:update", tc);
    return run;
  }

  async updateTestRun(id: string, data: Partial<{ status: string; notes: string; durationSeconds: number }>): Promise<TrackerTestRun | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (data.notes !== undefined) { sets.push("notes = ?"); params.push(data.notes); }
    if (data.durationSeconds !== undefined) { sets.push("duration_seconds = ?"); params.push(data.durationSeconds); }
    if (sets.length === 0) return this.getTestRun(id);
    params.push(id);
    await execute(`UPDATE tracker_test_runs SET ${sets.join(", ")} WHERE id = ?`, params);
    const run = await this.getTestRun(id);
    if (run) {
      this.emit("testrun:update", run);
      const tc = await this.getTestCase(run.testCaseId);
      if (tc) this.emit("testcase:update", tc);
    }
    return run;
  }

  async deleteTestRun(id: string): Promise<boolean> {
    const run = await this.getTestRun(id);
    const attachRows = await query<TestRunAttachmentRow[]>("SELECT * FROM tracker_test_run_attachments WHERE test_run_id = ?", [id]);
    for (const a of attachRows) {
      const path = resolve(UPLOADS_DIR, a.filename);
      if (existsSync(path)) unlinkSync(path);
    }
    const result = await execute("DELETE FROM tracker_test_runs WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("testrun:delete", { id });
      if (run) {
        const tc = await this.getTestCase(run.testCaseId);
        if (tc) this.emit("testcase:update", tc);
      }
      return true;
    }
    return false;
  }

  async uploadTestRunAttachment(testRunId: string, base64: string, filename: string, mimeType: string, uploadedBy: string): Promise<TrackerTestRunAttachment> {
    const buf = Buffer.from(base64, "base64");
    validateMedia(mimeType, buf.length);
    const file = saveUploadFile(base64, mimeType);
    await execute(
      "INSERT INTO tracker_test_run_attachments (id, test_run_id, filename, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
      [file.id, testRunId, file.filename, mimeType, file.size, uploadedBy],
    );
    const attachment: TrackerTestRunAttachment = {
      id: file.id, testRunId, filename: file.filename,
      mimeType, size: file.size, uploadedBy, uploadedAt: new Date().toISOString(),
    };
    this.emit("testrun:attachment", { testRunId, attachment });
    return attachment;
  }

  // ── Test Run Comments ──

  async getTestRunComments(testRunId: string): Promise<TrackerTestRunComment[]> {
    const rows = await query<TestRunCommentRow[]>(
      "SELECT * FROM tracker_test_run_comments WHERE test_run_id = ? ORDER BY created_at",
      [testRunId],
    );
    if (rows.length === 0) return [];
    const commentIds = rows.map((r) => r.id);
    const placeholders = commentIds.map(() => "?").join(",");
    const attachRows = await query<TestRunCommentAttachmentRow[]>(
      `SELECT * FROM tracker_test_run_comment_attachments WHERE comment_id IN (${placeholders}) ORDER BY uploaded_at`,
      commentIds,
    );
    const attachMap = new Map<string, TrackerTestRunCommentAttachment[]>();
    for (const a of attachRows) {
      const key = a.comment_id;
      const list = attachMap.get(key) || [];
      list.push(mapTestRunCommentAttachment(a));
      attachMap.set(key, list);
    }
    return rows.map((r) => mapTestRunComment(r, attachMap.get(r.id) || []));
  }

  async addTestRunComment(data: {
    testRunId: string; authorId: string; authorName: string; content: string;
    attachments?: Array<{ base64: string; filename: string; mimeType: string }>;
  }): Promise<TrackerTestRunComment> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_test_run_comments (id, test_run_id, author_id, author_name, content) VALUES (?, ?, ?, ?, ?)",
      [id, data.testRunId, data.authorId, data.authorName, data.content],
    );
    const savedAttachments: TrackerTestRunCommentAttachment[] = [];
    if (data.attachments?.length) {
      for (const att of data.attachments) {
        const buf = Buffer.from(att.base64, "base64");
        validateMedia(att.mimeType, buf.length);
        const file = saveUploadFile(att.base64, att.mimeType);
        await execute(
          "INSERT INTO tracker_test_run_comment_attachments (id, comment_id, filename, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
          [file.id, id, file.filename, att.mimeType, file.size, data.authorId],
        );
        savedAttachments.push({
          id: file.id, commentId: id, filename: file.filename,
          mimeType: att.mimeType, size: file.size,
          uploadedBy: data.authorId, uploadedAt: new Date().toISOString(),
        });
      }
    }
    const comment: TrackerTestRunComment = {
      id, testRunId: data.testRunId, authorId: data.authorId,
      authorName: data.authorName, content: data.content,
      attachments: savedAttachments, createdAt: new Date().toISOString(),
    };
    this.emit("testrun:comment", comment);
    return comment;
  }
}

export const trackerManager = new TrackerManager();
