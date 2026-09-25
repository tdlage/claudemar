export interface ExecutionTarget {
  targetType: "project" | "agent" | "orchestrator";
  targetName: string;
}

export function executionTargetFromBase(base?: string): ExecutionTarget | null {
  const targetType = base?.split(":")[0];
  if (targetType !== "project" && targetType !== "agent" && targetType !== "orchestrator") return null;
  const targetName = base!.slice(targetType.length + 1) || (targetType === "orchestrator" ? "orchestrator" : "");
  return { targetType, targetName };
}
