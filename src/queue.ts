import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "./config.js";
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
  enqueuedAt: string;
  telegramChatId?: number;
}

interface PersistedQueue {
  nextSeqId: number;
  items: QueueItem[];
}

const PERSIST_DEBOUNCE_MS = 1000;

class CommandQueue extends EventEmitter {
  private queues = new Map<string, QueueItem[]>();
  private nextSeqId = 1;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.load();
  }

  private filePath(): string {
    return resolve(config.basePath, "queue.json");
  }

  targetKey(targetType: string, targetName: string): string {
    return `${targetType}:${targetName}`;
  }

  enqueue(opts: Omit<QueueItem, "id" | "seqId" | "enqueuedAt">): QueueItem {
    const item: QueueItem = {
      ...opts,
      id: randomUUID(),
      seqId: this.nextSeqId++,
      enqueuedAt: new Date().toISOString(),
    };

    const key = this.targetKey(opts.targetType, opts.targetName);
    const queue = this.queues.get(key) ?? [];
    queue.push(item);
    this.queues.set(key, queue);

    this.schedulePersist();
    this.emit("queue:add", item);
    return item;
  }

  dequeue(targetKey: string): QueueItem | undefined {
    const queue = this.queues.get(targetKey);
    if (!queue || queue.length === 0) return undefined;

    const item = queue.shift()!;
    if (queue.length === 0) {
      this.queues.delete(targetKey);
    }

    this.schedulePersist();
    this.emit("queue:remove", item);
    return item;
  }

  remove(seqId: number): QueueItem | null {
    for (const [key, queue] of this.queues) {
      const idx = queue.findIndex((item) => item.seqId === seqId);
      if (idx !== -1) {
        const [item] = queue.splice(idx, 1);
        if (queue.length === 0) {
          this.queues.delete(key);
        }
        this.schedulePersist();
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

  private load(): void {
    const path = this.filePath();
    if (!existsSync(path)) return;

    try {
      const raw = readFileSync(path, "utf-8");
      const data: PersistedQueue = JSON.parse(raw);
      this.nextSeqId = data.nextSeqId ?? 1;

      for (const item of data.items ?? []) {
        const key = this.targetKey(item.targetType, item.targetName);
        const queue = this.queues.get(key) ?? [];
        queue.push(item);
        this.queues.set(key, queue);
      }
    } catch {
      // corrupted file, start fresh
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persist(): void {
    const items = this.getAll();
    const data: PersistedQueue = {
      nextSeqId: this.nextSeqId,
      items,
    };
    const target = this.filePath();
    const tmp = target + ".tmp";
    writeFile(tmp, JSON.stringify(data, null, 2), "utf-8")
      .then(() => rename(tmp, target))
      .catch((err) => console.error("[queue] persist failed:", err));
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const items = this.getAll();
    const data: PersistedQueue = { nextSeqId: this.nextSeqId, items };
    const target = this.filePath();
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmp, target);
    } catch (err) {
      console.error("[queue] flush failed:", err);
    }
  }
}

export const commandQueue = new CommandQueue();
