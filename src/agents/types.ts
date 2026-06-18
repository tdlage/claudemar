export interface AgentInfo {
  name: string;
  lastExecution: Date | null;
}

export interface AgentPaths {
  root: string;
  context: string;
  output: string;
  input: string;
}
