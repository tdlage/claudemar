import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";
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
  useDocker?: boolean;
  enqueuedAt: string;
  telegramChatId?: number;
}

interface PersistedQueue {
  nextSeqId: number;
  items: QueueItem[];
}

class CommandQueue extends EventEmitter {
  private queues = new Map<string, QueueItem[]>();
  private nextSeqId = 1;
  private persister = new JsonPersister(resolve(config.dataPath, "queue.json"), "queue");

  constructor() {
    super();
    this.load();
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

    this.persist();
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

    this.persist();
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
        this.persist();
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
    const data = this.persister.readSync() as PersistedQueue | null;
    if (!data) return;
    this.nextSeqId = data.nextSeqId ?? 1;
    for (const item of data.items ?? []) {
      const key = this.targetKey(item.targetType, item.targetName);
      const queue = this.queues.get(key) ?? [];
      queue.push(item);
      this.queues.set(key, queue);
    }
  }

  private persistData(): PersistedQueue {
    return { nextSeqId: this.nextSeqId, items: this.getAll() };
  }

  private persist(): void {
    this.persister.scheduleWrite(() => this.persistData());
  }

  flush(): void {
    this.persister.flushSync(this.persistData());
  }
}

export const commandQueue = new CommandQueue();
