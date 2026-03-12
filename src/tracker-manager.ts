import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { query, execute, getPool } from "./database.js";
import { config } from "./config.js";
import { DEFAULT_COLUMNS } from "./tracker-migration.js";
import { signUploadUrl } from "./upload-signer.js";
import type { CycleColumn } from "./tracker-migration.js";
import type { AskQuestion } from "./executor.js";
import type { RowDataPacket } from "mysql2/promise";

export type { CycleColumn } from "./tracker-migration.js";

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

export interface TrackerProject {
  id: string;
  name: string;
  code: string;
  description: string;
  nextItemNumber: number;
  createdBy: string;
  createdAt: string;
}

export interface TrackerCycle {
  id: string;
  projectId: string;
  name: string;
  status: "active" | "completed";
  columns: CycleColumn[];
  createdBy: string;
  createdAt: string;
}

export interface ItemTestStats {
  total: number;
  passed: number;
  failed: number;
  noRuns: number;
}

export interface TrackerItem {
  id: string;
  cycleId: string;
  title: string;
  description: string;
  columnId: string;
  appetite: number;
  priority: string | null;
  startedAt: string | null;
  inScope: string;
  outOfScope: string;
  assignees: string[];
  tags: string[];
  seqNumber: number;
  position: number;
  testStats: ItemTestStats;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackerComment {
  id: string;
  targetType: "item";
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
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TrackerTestCase {
  id: string;
  targetType: "item";
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
  url: string;
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
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export type ItemPlanStatus = "planning" | "planned" | "executing" | "reviewing" | "completed" | "error";

export interface TrackerItemPlan {
  id: string;
  itemId: string;
  targetProject: string;
  sessionId: string | null;
  status: ItemPlanStatus;
  promptSent: string;
  planMarkdown: string | null;
  pendingQuestions: AskQuestion[] | null;
  lastExecutionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Row types ──

interface ProjectRow extends RowDataPacket {
  id: string;
  name: string;
  code: string;
  description: string | null;
  next_bet_number: number;
  created_by: string;
  created_at: string;
}

interface CycleRow extends RowDataPacket {
  id: string;
  project_id: string;
  name: string;
  status: string;
  columns: string;
  created_by: string;
  created_at: string;
}

interface ItemRow extends RowDataPacket {
  id: string;
  cycle_id: string;
  title: string;
  description: string | null;
  column_id: string;
  appetite: number;
  priority: string | null;
  started_at: string | null;
  in_scope: string | null;
  out_of_scope: string | null;
  tags: string | null;
  seq_number: number;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AssigneeRow extends RowDataPacket {
  item_id: string;
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

interface ItemPlanRow extends RowDataPacket {
  id: string;
  item_id: string;
  target_project: string;
  session_id: string | null;
  status: string;
  prompt_sent: string;
  plan_markdown: string | null;
  pending_questions: string | null;
  last_execution_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Mappers ──

function mapProject(r: ProjectRow): TrackerProject {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description || "",
    nextItemNumber: r.next_bet_number,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapCycle(r: CycleRow): TrackerCycle {
  let columns: CycleColumn[] = DEFAULT_COLUMNS;
  try {
    columns = typeof r.columns === "string" ? JSON.parse(r.columns) : r.columns;
  } catch { /* fallback to defaults */ }
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    status: r.status as TrackerCycle["status"],
    columns,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function mapItem(r: ItemRow, assignees: string[], testStats?: ItemTestStats): TrackerItem {
  let tags: string[] = [];
  if (r.tags) {
    try { tags = typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags; } catch { /* empty */ }
  }
  return {
    id: r.id,
    cycleId: r.cycle_id,
    title: r.title,
    description: r.description || "",
    columnId: r.column_id,
    appetite: r.appetite,
    priority: r.priority || null,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    inScope: r.in_scope || "",
    outOfScope: r.out_of_scope || "",
    assignees,
    tags,
    seqNumber: r.seq_number,
    position: r.position,
    testStats: testStats ?? { total: 0, passed: 0, failed: 0, noRuns: 0 },
    createdBy: r.created_by,
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
    url: signUploadUrl(r.filename),
    mimeType: r.mime_type,
    size: r.size,
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
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
    url: signUploadUrl(r.filename),
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
    url: signUploadUrl(r.filename),
    mimeType: r.mime_type,
    size: Number(r.size),
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

function mapItemPlan(r: ItemPlanRow): TrackerItemPlan {
  let pendingQuestions: AskQuestion[] | null = null;
  if (r.pending_questions) {
    try { pendingQuestions = typeof r.pending_questions === "string" ? JSON.parse(r.pending_questions) : r.pending_questions; } catch { /* empty */ }
  }
  return {
    id: r.id,
    itemId: r.item_id,
    targetProject: r.target_project,
    sessionId: r.session_id,
    status: r.status as ItemPlanStatus,
    promptSent: r.prompt_sent,
    planMarkdown: r.plan_markdown,
    pendingQuestions,
    lastExecutionId: r.last_execution_id,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// ── Manager ──

class TrackerManager extends EventEmitter {

  // ── Projects ──

  async getProjects(): Promise<TrackerProject[]> {
    const rows = await query<ProjectRow[]>("SELECT * FROM tracker_projects ORDER BY created_at DESC");
    return rows.map(mapProject);
  }

  async getProject(id: string): Promise<TrackerProject | null> {
    const rows = await query<ProjectRow[]>("SELECT * FROM tracker_projects WHERE id = ?", [id]);
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async createProject(data: { name: string; code: string; description?: string; createdBy: string }): Promise<TrackerProject> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_projects (id, name, code, description, created_by) VALUES (?, ?, ?, ?, ?)",
      [id, data.name, data.code.toUpperCase(), data.description || "", data.createdBy],
    );
    const project = (await this.getProject(id))!;
    this.emit("project:create", project);
    return project;
  }

  async updateProject(id: string, data: Partial<{ name: string; description: string }>): Promise<TrackerProject | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); params.push(data.name); }
    if (data.description !== undefined) { sets.push("description = ?"); params.push(data.description); }
    if (sets.length === 0) return this.getProject(id);
    params.push(id);
    await execute(`UPDATE tracker_projects SET ${sets.join(", ")} WHERE id = ?`, params);
    const project = await this.getProject(id);
    if (project) this.emit("project:update", project);
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_projects WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("project:delete", { id });
      return true;
    }
    return false;
  }

  // ── Cycles ──

  async getCyclesByProject(projectId: string): Promise<TrackerCycle[]> {
    const rows = await query<CycleRow[]>("SELECT * FROM tracker_cycles WHERE project_id = ? ORDER BY created_at DESC", [projectId]);
    return rows.map(mapCycle);
  }

  async getCycle(id: string): Promise<TrackerCycle | null> {
    const rows = await query<CycleRow[]>("SELECT * FROM tracker_cycles WHERE id = ?", [id]);
    return rows[0] ? mapCycle(rows[0]) : null;
  }

  async createCycle(data: { projectId: string; name: string; createdBy: string }): Promise<TrackerCycle> {
    const id = randomUUID();
    const cols = DEFAULT_COLUMNS.map((c, i) => ({ ...c, id: randomUUID(), position: i }));
    await execute(
      "INSERT INTO tracker_cycles (id, project_id, name, columns, created_by) VALUES (?, ?, ?, ?, ?)",
      [id, data.projectId, data.name, JSON.stringify(cols), data.createdBy],
    );
    const cycle = (await this.getCycle(id))!;
    this.emit("cycle:create", cycle);
    return cycle;
  }

  async updateCycle(id: string, data: Partial<{ name: string; status: string; columns: CycleColumn[] }>): Promise<TrackerCycle | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); params.push(data.name); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (data.columns !== undefined) { sets.push("columns = ?"); params.push(JSON.stringify(data.columns)); }
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

  async getCycleItemStats(projectId: string): Promise<Map<string, { total: number; byColumn: Map<string, number> }>> {
    const map = new Map<string, { total: number; byColumn: Map<string, number> }>();
    const rows = await query<RowDataPacket[]>(
      `SELECT b.cycle_id, b.column_id, COUNT(*) AS cnt
       FROM tracker_bets b
       JOIN tracker_cycles c ON b.cycle_id = c.id
       WHERE c.project_id = ?
       GROUP BY b.cycle_id, b.column_id`,
      [projectId],
    );
    for (const r of rows) {
      let entry = map.get(r.cycle_id);
      if (!entry) {
        entry = { total: 0, byColumn: new Map() };
        map.set(r.cycle_id, entry);
      }
      const cnt = Number(r.cnt);
      entry.total += cnt;
      entry.byColumn.set(r.column_id, cnt);
    }
    return map;
  }

  // ── Items ──

  private async getItemAssignees(itemIds: string[]): Promise<Map<string, string[]>> {
    if (itemIds.length === 0) return new Map();
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = await query<AssigneeRow[]>(`SELECT item_id, user_id FROM tracker_item_assignees WHERE item_id IN (${placeholders})`, itemIds);
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.item_id) || [];
      list.push(r.user_id);
      map.set(r.item_id, list);
    }
    return map;
  }

  async getItemsByCycle(cycleId: string): Promise<TrackerItem[]> {
    const rows = await query<ItemRow[]>("SELECT * FROM tracker_bets WHERE cycle_id = ? ORDER BY position, created_at", [cycleId]);
    const itemIds = rows.map((r) => r.id);
    const assigneesMap = await this.getItemAssignees(itemIds);
    const testStatsMap = await this.getItemTestStats(itemIds);
    return rows.map((r) => mapItem(r, assigneesMap.get(r.id) || [], testStatsMap.get(r.id)));
  }

  private async getItemTestStats(itemIds: string[]): Promise<Map<string, ItemTestStats>> {
    const map = new Map<string, ItemTestStats>();
    if (itemIds.length === 0) return map;
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = await query<RowDataPacket[]>(`
      SELECT
        tc.target_id AS item_id,
        COUNT(*) AS total,
        SUM(CASE WHEN lr.status = 'passed' THEN 1 ELSE 0 END) AS passed,
        SUM(CASE WHEN lr.status IN ('failed', 'blocked', 'skipped') THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN lr.status IS NULL THEN 1 ELSE 0 END) AS no_runs
      FROM tracker_test_cases tc
      LEFT JOIN (
        SELECT tr.test_case_id, tr.status
        FROM tracker_test_runs tr
        INNER JOIN (
          SELECT test_case_id, MAX(executed_at) AS max_at
          FROM tracker_test_runs
          GROUP BY test_case_id
        ) latest ON tr.test_case_id = latest.test_case_id AND tr.executed_at = latest.max_at
      ) lr ON lr.test_case_id = tc.id
      WHERE tc.target_type = 'item' AND tc.target_id IN (${placeholders})
      GROUP BY tc.target_id
    `, itemIds);
    for (const r of rows) {
      map.set(r.item_id, {
        total: Number(r.total),
        passed: Number(r.passed),
        failed: Number(r.failed),
        noRuns: Number(r.no_runs),
      });
    }
    return map;
  }

  async getItem(id: string): Promise<TrackerItem | null> {
    const rows = await query<ItemRow[]>("SELECT * FROM tracker_bets WHERE id = ?", [id]);
    if (!rows[0]) return null;
    const assigneesMap = await this.getItemAssignees([id]);
    const testStatsMap = await this.getItemTestStats([id]);
    return mapItem(rows[0], assigneesMap.get(id) || [], testStatsMap.get(id));
  }

  async createItem(data: {
    cycleId: string; title: string; description?: string; columnId: string;
    appetite?: number; priority?: string; inScope?: string; outOfScope?: string;
    assignees?: string[]; tags?: string[]; createdBy: string;
  }): Promise<TrackerItem> {
    const id = randomUUID();
    const maxPos = await query<RowDataPacket[]>("SELECT COALESCE(MAX(position), -1) AS mp FROM tracker_bets WHERE cycle_id = ?", [data.cycleId]);
    const position = (maxPos[0]?.mp ?? -1) + 1;

    const cycle = await this.getCycle(data.cycleId);
    if (!cycle) throw new Error("Cycle not found");
    const conn = await getPool().getConnection();
    let seqNumber: number;
    try {
      await conn.execute("UPDATE tracker_projects SET next_bet_number = LAST_INSERT_ID(next_bet_number), next_bet_number = next_bet_number + 1 WHERE id = ?", [cycle.projectId]);
      const [seqRows] = await conn.execute<RowDataPacket[]>("SELECT LAST_INSERT_ID() AS seq");
      seqNumber = seqRows[0]?.seq ?? 1;
    } finally {
      conn.release();
    }

    await execute(
      "INSERT INTO tracker_bets (id, cycle_id, title, description, column_id, appetite, priority, in_scope, out_of_scope, tags, seq_number, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, data.cycleId, data.title, data.description || "", data.columnId, data.appetite ?? 7,
       data.priority || null, data.inScope || "", data.outOfScope || "", JSON.stringify(data.tags || []), seqNumber, position, data.createdBy],
    );
    if (data.assignees?.length) {
      await execute(`INSERT INTO tracker_item_assignees (item_id, user_id) VALUES ${data.assignees.map(() => "(?, ?)").join(",")}`,
        data.assignees.flatMap((uid) => [id, uid]));
    }
    const item = (await this.getItem(id))!;
    this.emit("item:create", item);
    return item;
  }

  async updateItem(id: string, data: Partial<{
    title: string; description: string; columnId: string; appetite: number;
    priority: string | null; inScope: string; outOfScope: string; assignees: string[]; tags: string[];
  }>): Promise<TrackerItem | null> {
    const sets: string[] = [];
    const params: (string | number | null | boolean)[] = [];
    if (data.title !== undefined) { sets.push("title = ?"); params.push(data.title); }
    if (data.description !== undefined) { sets.push("description = ?"); params.push(data.description); }
    if (data.columnId !== undefined) { sets.push("column_id = ?"); params.push(data.columnId); }
    if (data.appetite !== undefined) { sets.push("appetite = ?"); params.push(data.appetite); }
    if (data.priority !== undefined) { sets.push("priority = ?"); params.push(data.priority); }
    if (data.inScope !== undefined) { sets.push("in_scope = ?"); params.push(data.inScope); }
    if (data.outOfScope !== undefined) { sets.push("out_of_scope = ?"); params.push(data.outOfScope); }
    if (data.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(data.tags)); }
    if (sets.length > 0) {
      params.push(id);
      await execute(`UPDATE tracker_bets SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    if (data.assignees !== undefined) {
      await execute("DELETE FROM tracker_item_assignees WHERE item_id = ?", [id]);
      if (data.assignees.length > 0) {
        await execute(
          `INSERT INTO tracker_item_assignees (item_id, user_id) VALUES ${data.assignees.map(() => "(?, ?)").join(",")}`,
          data.assignees.flatMap((uid) => [id, uid]),
        );
      }
    }
    const item = await this.getItem(id);
    if (item) this.emit("item:update", item);
    return item;
  }

  async moveItem(id: string, columnId: string, position: number): Promise<TrackerItem | null> {
    const item = await this.getItem(id);
    if (!item) return null;

    const cycle = await this.getCycle(item.cycleId);
    if (!cycle) return null;

    const sortedColumns = [...cycle.columns].sort((a, b) => a.position - b.position);
    const firstColumnId = sortedColumns[0]?.id;
    const isLeavingFirstColumn = item.columnId === firstColumnId && columnId !== firstColumnId;

    if (isLeavingFirstColumn && !item.startedAt) {
      await execute("UPDATE tracker_bets SET column_id = ?, position = ?, started_at = NOW() WHERE id = ?", [columnId, position, id]);
    } else {
      await execute("UPDATE tracker_bets SET column_id = ?, position = ? WHERE id = ?", [columnId, position, id]);
    }

    const updated = await this.getItem(id);
    if (updated) this.emit("item:update", updated);
    return updated;
  }

  async deleteItem(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_bets WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("item:delete", { id });
      return true;
    }
    return false;
  }

  async searchItems(q: string): Promise<Array<{ id: string; code: string; title: string; cycleId: string; columnId: string }>> {
    const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    const rows = await query<RowDataPacket[]>(`
      SELECT b.id, b.title, b.cycle_id, b.column_id, b.seq_number, p.code AS project_code
      FROM tracker_bets b
      JOIN tracker_cycles c ON b.cycle_id = c.id
      JOIN tracker_projects p ON c.project_id = p.id
      WHERE p.code LIKE ? OR b.title LIKE ? OR CONCAT(p.code, '-', b.seq_number) LIKE ?
      ORDER BY p.code, b.seq_number DESC
      LIMIT 20
    `, [pattern, pattern, pattern]);
    return rows.map((r) => ({
      id: r.id,
      code: `${r.project_code}-${r.seq_number}`,
      title: r.title,
      cycleId: r.cycle_id,
      columnId: r.column_id,
    }));
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
          url: signUploadUrl(file.filename),
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
    if (data.attachments?.length) {
      for (const att of data.attachments) {
        const buf = Buffer.from(att.base64, "base64");
        validateMedia(att.mimeType, buf.length);
        const file = saveUploadFile(att.base64, att.mimeType);
        await execute(
          "INSERT INTO tracker_test_run_attachments (id, test_run_id, filename, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
          [file.id, id, file.filename, att.mimeType, file.size, data.executedBy],
        );
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
      url: signUploadUrl(file.filename),
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
          url: signUploadUrl(file.filename),
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
  async getItemCode(itemId: string): Promise<string | null> {
    const rows = await query<RowDataPacket[]>(
      `SELECT p.code, b.seq_number FROM tracker_bets b
       JOIN tracker_cycles c ON b.cycle_id = c.id
       JOIN tracker_projects p ON c.project_id = p.id
       WHERE b.id = ?`,
      [itemId],
    );
    if (!rows[0]) return null;
    return `${rows[0].code}-${rows[0].seq_number}`;
  }

  // ── Item Plans ──

  async getItemPlan(itemId: string): Promise<TrackerItemPlan | null> {
    const rows = await query<ItemPlanRow[]>("SELECT * FROM tracker_item_plans WHERE item_id = ? LIMIT 1", [itemId]);
    return rows[0] ? mapItemPlan(rows[0]) : null;
  }

  async createItemPlan(data: { itemId: string; targetProject: string; promptSent: string; createdBy: string }): Promise<TrackerItemPlan> {
    const id = randomUUID();
    await execute(
      "INSERT INTO tracker_item_plans (id, item_id, target_project, prompt_sent, created_by) VALUES (?, ?, ?, ?, ?)",
      [id, data.itemId, data.targetProject, data.promptSent, data.createdBy],
    );
    const plan = (await this.getItemPlanById(id))!;
    this.emit("plan:create", plan);
    return plan;
  }

  async updateItemPlan(id: string, data: Partial<{
    sessionId: string;
    status: ItemPlanStatus;
    planMarkdown: string;
    pendingQuestions: AskQuestion[] | null;
    lastExecutionId: string;
  }>): Promise<TrackerItemPlan | null> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (data.sessionId !== undefined) { sets.push("session_id = ?"); params.push(data.sessionId); }
    if (data.status !== undefined) { sets.push("status = ?"); params.push(data.status); }
    if (data.planMarkdown !== undefined) { sets.push("plan_markdown = ?"); params.push(data.planMarkdown); }
    if (data.pendingQuestions !== undefined) { sets.push("pending_questions = ?"); params.push(data.pendingQuestions ? JSON.stringify(data.pendingQuestions) : null); }
    if (data.lastExecutionId !== undefined) { sets.push("last_execution_id = ?"); params.push(data.lastExecutionId); }
    if (sets.length === 0) return this.getItemPlanById(id);
    params.push(id);
    await execute(`UPDATE tracker_item_plans SET ${sets.join(", ")} WHERE id = ?`, params);
    const plan = await this.getItemPlanById(id);
    if (plan) this.emit("plan:update", plan);
    return plan;
  }

  async deleteItemPlan(id: string): Promise<boolean> {
    const result = await execute("DELETE FROM tracker_item_plans WHERE id = ?", [id]);
    if (result.affectedRows > 0) {
      this.emit("plan:delete", { id });
      return true;
    }
    return false;
  }

  private async getItemPlanById(id: string): Promise<TrackerItemPlan | null> {
    const rows = await query<ItemPlanRow[]>("SELECT * FROM tracker_item_plans WHERE id = ?", [id]);
    return rows[0] ? mapItemPlan(rows[0]) : null;
  }
}

export const trackerManager = new TrackerManager();
