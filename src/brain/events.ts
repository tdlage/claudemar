import { EventEmitter } from "node:events";
import { pushActivity } from "./redis.js";
import type { BrainScope } from "./scope.js";
import type { BrainActivityItem } from "./types.js";

export const brainEvents = new EventEmitter();

export type BrainOwnerEventName = "activity" | "google" | "slack" | "backfill";

/** Todo evento do brain carrega o dono: o socket só o entrega na sala daquele dono. */
export interface BrainOwnerEvent<T = unknown> {
  owner: string;
  data: T;
}

export function emitBrainEvent<T>(scope: BrainScope, name: BrainOwnerEventName, data: T): void {
  const event: BrainOwnerEvent<T> = { owner: scope.owner, data };
  brainEvents.emit(name, event);
}

export function emitActivity(scope: BrainScope, item: Omit<BrainActivityItem, "at">): void {
  const full: BrainActivityItem = { at: new Date().toISOString(), ...item };
  void pushActivity(scope, full);
  emitBrainEvent(scope, "activity", full);
}

export function emitStatusChanged(scope: BrainScope): void {
  brainEvents.emit("status-changed", scope.owner);
}
