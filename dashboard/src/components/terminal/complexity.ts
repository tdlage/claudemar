import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ExecutionTarget } from "../../lib/target";
import type { AgentRuntime } from "../../lib/types";
import type { Effort } from "./effortOptions";

export interface ComplexityAssessment {
  complexity: number;
  confidence: number;
  effort: Effort;
}

export function useComplexityEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await api.get<{ enabled: boolean }>("/executions/complexity");
        if (!cancelled) setEnabled(status.enabled === true);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

export function assessComplexity(prompt: string, runtime: AgentRuntime, target: ExecutionTarget): Promise<ComplexityAssessment> {
  return api.post<ComplexityAssessment>("/executions/complexity", { prompt, runtime, ...target });
}
