import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { query, execute } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";
import type { ExecutionSource, ExecutionTargetType } from "./execution-manager.js";

export interface QueueItem {
  id: string;
  seqId: number;
  targetType: ExecutionTargetType;
  targetName: string;
  prompt: string;
  source: ExecutionSource;
  cwd: string;
  resumeSessionId?: string | null;
  model?: string;
  planMode?: boolean;
  agentName?: string;
  username?: string;
  useDocker?: boolean;
  enqueuedAt: string;
  telegramChatId?: number;
}

interface QueueRow extends RowDataPacket {
  seq_id: number;
  id: string;
  target_type: string;
  target_name: string;
  prompt: string;
  source: string;
  cwd: string;
  resume_session_id: string | null;
  model: string | null;
  plan_mode: number;
  agent_name: string | null;
  username: string | null;
  use_docker: number;
  enqueued_at: string | Date;
  telegram_chat_id: number | null;
}

function rowToItem(row: QueueRow): QueueItem {
  const enqueuedAt = row.enqueued_at instanceof Date ? row.enqueued_at.toISOString() : String(row.enqueued_at);
  return {
    id: row.id,
    seqId: row.seq_id,
    targetType: row.target_type as ExecutionTargetType,
    targetName: row.target_name,
    prompt: row.prompt,
    source: row.source as ExecutionSource,
    cwd: row.cwd,
    resumeSessionId: row.resume_session_id,
    model: row.model ?? undefined,
    planMode: row.plan_mode === 1 ? true : undefined,
    agentName: row.agent_name ?? undefined,
    username: row.username ?? undefined,
    useDocker: row.use_docker === 1 ? true : undefined,
    enqueuedAt,
    telegramChatId: row.telegram_chat_id ?? undefined,
  };
}

class CommandQueue extends EventEmitter {
  private queues = new Map<string, QueueItem[]>();

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    const rows = await query<QueueRow[]>("SELECT * FROM queue_items ORDER BY seq_id ASC");
    for (const row of rows) {
      const item = rowToItem(row);
      const key = this.targetKey(item.targetType, item.targetName);
      const queue = this.queues.get(key) ?? [];
      queue.push(item);
      this.queues.set(key, queue);
    }
  }

  targetKey(targetType: string, targetName: string): string {
    return `${targetType}:${targetName}`;
  }

  async enqueue(opts: Omit<QueueItem, "id" | "seqId" | "enqueuedAt">): Promise<QueueItem> {
    const id = randomUUID();
    const enqueuedAt = new Date().toISOString();

    const result = await execute(
      `INSERT INTO queue_items (id, target_type, target_name, prompt, source, cwd, resume_session_id, model, plan_mode, agent_name, username, use_docker, enqueued_at, telegram_chat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, opts.targetType, opts.targetName, opts.prompt, opts.source, opts.cwd,
       opts.resumeSessionId ?? null, opts.model ?? null, opts.planMode ? 1 : 0,
       opts.agentName ?? null, opts.username ?? null, opts.useDocker ? 1 : 0,
       enqueuedAt, opts.telegramChatId ?? null],
    );

    const item: QueueItem = {
      ...opts,
      id,
      seqId: result.insertId,
      enqueuedAt,
    };

    const key = this.targetKey(opts.targetType, opts.targetName);
    const queue = this.queues.get(key) ?? [];
    queue.push(item);
    this.queues.set(key, queue);

    this.emit("queue:add", item);
    return item;
  }

  async dequeue(targetKey: string): Promise<QueueItem | undefined> {
    const queue = this.queues.get(targetKey);
    if (!queue || queue.length === 0) return undefined;

    const item = queue.shift()!;
    if (queue.length === 0) {
      this.queues.delete(targetKey);
    }

    await execute("DELETE FROM queue_items WHERE id = ?", [item.id]);
    this.emit("queue:remove", item);
    return item;
  }

  async remove(seqId: number): Promise<QueueItem | null> {
    for (const [key, queue] of this.queues) {
      const idx = queue.findIndex((item) => item.seqId === seqId);
      if (idx !== -1) {
        const [item] = queue.splice(idx, 1);
        if (queue.length === 0) {
          this.queues.delete(key);
        }
        await execute("DELETE FROM queue_items WHERE seq_id = ?", [seqId]);
        this.emit("queue:remove", item);
        return item;
      }
    }
    return null;
  }

  getAll(): QueueItem[] {
    const items: QueueItem[] = [];
    for (const queue of this.queues.values()) {
      items.push(...queue);
    }
    return items.sort((a, b) => a.seqId - b.seqId);
  }

  getByTarget(targetType: string, targetName: string): QueueItem[] {
    const key = this.targetKey(targetType, targetName);
    return this.queues.get(key) ?? [];
  }

  getGrouped(): Map<string, QueueItem[]> {
    return new Map(this.queues);
  }

  peek(targetType: string, targetName: string): QueueItem | undefined {
    const key = this.targetKey(targetType, targetName);
    const queue = this.queues.get(key);
    return queue?.[0];
  }
}

export const commandQueue = new CommandQueue();
