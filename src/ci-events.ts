import { EventEmitter } from "node:events";

export interface CIWorkflowRunEvent {
  action: string;
  owner: string;
  repo: string;
  repoFullName: string;
  runId: number;
  runNumber: number;
  name: string;
  displayTitle: string;
  headBranch: string;
  event: string;
  status: string;
  conclusion: string | null;
  url: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
}

class CIEventManager extends EventEmitter {
  emitWorkflowRun(event: CIWorkflowRunEvent): void {
    this.emit("workflow_run", event);
  }
}

export const ciEventManager = new CIEventManager();
