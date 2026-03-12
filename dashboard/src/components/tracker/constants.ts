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

export const ITEM_PRIORITIES = [
  { value: "P1", label: "P1 - Urgente", color: "text-danger bg-danger/10" },
  { value: "P2", label: "P2 - Alta", color: "text-warning bg-warning/10" },
  { value: "P3", label: "P3 - Média", color: "text-accent bg-accent/10" },
  { value: "P4", label: "P4 - Baixa", color: "text-text-muted bg-border" },
  { value: "P5", label: "P5 - Muito baixa", color: "text-text-muted bg-border" },
] as const;

export function getPriorityConfig(priority: string | null) {
  return ITEM_PRIORITIES.find((p) => p.value === priority) ?? null;
}

const CYCLE_COLORS = [
  { bg: "#3b82f6", text: "#ffffff" },
  { bg: "#8b5cf6", text: "#ffffff" },
  { bg: "#ec4899", text: "#ffffff" },
  { bg: "#f97316", text: "#ffffff" },
  { bg: "#14b8a6", text: "#ffffff" },
  { bg: "#eab308", text: "#1a1a1a" },
  { bg: "#06b6d4", text: "#ffffff" },
  { bg: "#ef4444", text: "#ffffff" },
  { bg: "#22c55e", text: "#ffffff" },
  { bg: "#a855f7", text: "#ffffff" },
  { bg: "#f43f5e", text: "#ffffff" },
  { bg: "#0ea5e9", text: "#ffffff" },
];

export function getCycleColor(cycleId: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < cycleId.length; i++) {
    hash = ((hash << 5) - hash + cycleId.charCodeAt(i)) | 0;
  }
  return CYCLE_COLORS[Math.abs(hash) % CYCLE_COLORS.length];
}
