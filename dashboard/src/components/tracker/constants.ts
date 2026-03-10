import type { CycleStatus, BetStatus, TestRunStatus, TestCasePriority } from "../../lib/types";

export const CYCLE_STATUS_VARIANT: Record<CycleStatus, "info" | "warning" | "accent" | "default" | "success"> = {
  shaping: "info",
  betting: "warning",
  building: "accent",
  cooldown: "default",
  completed: "success",
};

export const BET_STATUS_VARIANT: Record<BetStatus, "info" | "warning" | "accent" | "success" | "default"> = {
  pitch: "info",
  bet: "warning",
  in_progress: "accent",
  done: "success",
  dropped: "default",
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
