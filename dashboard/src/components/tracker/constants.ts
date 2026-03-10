import type { CycleStatus, TestRunStatus, TestCasePriority } from "../../lib/types";

export function getDaysSpent(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 86400000) + 1;
}

export const CYCLE_STATUS_VARIANT: Record<CycleStatus, "success" | "default"> = {
  active: "success",
  completed: "default",
};

export const TEST_RUN_STATUS_CONFIG: Record<TestRunStatus, { icon: string; variant: "success" | "danger" | "warning" | "default"; color: string }> = {
  passed: { icon: "✓", variant: "success", color: "text-success" },
  failed: { icon: "✗", variant: "danger", color: "text-danger" },
  blocked: { icon: "⊘", variant: "warning", color: "text-warning" },
  skipped: { icon: "—", variant: "default", color: "text-text-muted" },
};

export const PRIORITY_VARIANT: Record<TestCasePriority, "danger" | "warning" | "info" | "default"> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "default",
};
