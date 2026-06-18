export interface QuestionOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: { questions: AskQuestion[] };
}

export interface AgentResult {
  output: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  totalTokens: number;
  isError: boolean;
  errorMessages: string[];
  permissionDenials: PermissionDenial[];
}

