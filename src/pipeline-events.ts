import { EventEmitter } from "node:events";

export interface PrFeedbackEvent {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
  body: string;
  author: string;
}

export interface PrMergedEvent {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
  merged: boolean;
}

export interface PrReopenedEvent {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
}

class PipelineEventManager extends EventEmitter {
  emitPrFeedback(event: PrFeedbackEvent): void {
    this.emit("pr:feedback", event);
  }

  emitPrClosed(event: PrMergedEvent): void {
    this.emit("pr:closed", event);
  }

  emitPrReopened(event: PrReopenedEvent): void {
    this.emit("pr:reopened", event);
  }
}

export const pipelineEventManager = new PipelineEventManager();
