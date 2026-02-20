export type SessionMode = "projects" | "agents";

export interface AgentInfo {
  name: string;
  inboxCount: number;
  lastExecution: Date | null;
}

export interface AgentPaths {
  root: string;
  context: string;
  inbox: string;
  outbox: string;
  output: string;
  input: string;
}
