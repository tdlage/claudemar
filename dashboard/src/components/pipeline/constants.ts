import type { PipelineStage, PipelineCardStatus, PipelineRunStatus } from "../../lib/types";

export const PIPELINE_STAGES: { key: PipelineStage; label: string; color: string }[] = [
  { key: "requirement", label: "Requisito", color: "#6366f1" },
  { key: "plan", label: "Plano", color: "#3b82f6" },
  { key: "implementation", label: "Implementação", color: "#f59e0b" },
  { key: "code_review", label: "Code Review", color: "#ec4899" },
  { key: "e2e", label: "E2E", color: "#a855f7" },
  { key: "pull_request", label: "Pull Request", color: "#22c55e" },
  { key: "monitor", label: "Monitor", color: "#14b8a6" },
];

export const SKIPPABLE_STAGES: PipelineStage[] = ["requirement", "plan", "code_review", "e2e", "pull_request"];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  intake: "Intake",
  requirement: "Requisito",
  plan: "Plano",
  implementation: "Implementação",
  code_review: "Code Review",
  e2e: "E2E",
  pull_request: "Pull Request",
  monitor: "Monitor",
};

type Variant = "default" | "success" | "warning" | "danger" | "accent" | "info";

export const CARD_STATUS_CONFIG: Record<PipelineCardStatus, { label: string; variant: Variant }> = {
  idle: { label: "Na fila", variant: "default" },
  running: { label: "Executando", variant: "info" },
  awaiting_gate: { label: "Aguardando aprovação", variant: "warning" },
  failed: { label: "Falhou", variant: "danger" },
  done: { label: "Concluído", variant: "success" },
};

export const RUN_STATUS_CONFIG: Record<PipelineRunStatus, { label: string; variant: Variant }> = {
  running: { label: "Executando", variant: "info" },
  passed: { label: "OK", variant: "success" },
  failed: { label: "Falhou", variant: "danger" },
  error: { label: "Erro", variant: "danger" },
  cancelled: { label: "Cancelado", variant: "default" },
};
