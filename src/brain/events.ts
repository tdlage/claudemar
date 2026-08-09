import { EventEmitter } from "node:events";
import { pushActivity } from "./redis.js";
import type { BrainActivityItem } from "./types.js";

export const brainEvents = new EventEmitter();

export function emitActivity(item: Omit<BrainActivityItem, "at">): void {
  const full: BrainActivityItem = { at: new Date().toISOString(), ...item };
  void pushActivity(full);
  brainEvents.emit("activity", full);
}

export function emitStatusChanged(): void {
  brainEvents.emit("status-changed");
}
