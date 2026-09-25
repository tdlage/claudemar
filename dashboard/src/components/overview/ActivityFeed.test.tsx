import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityFeed } from "./ActivityFeed";
import type { ExecutionInfo } from "../../lib/types";

function execution(overrides: Partial<ExecutionInfo>): ExecutionInfo {
  return {
    id: "exec",
    source: "web",
    targetType: "project",
    targetName: "site",
    prompt: "Corrija o login",
    cwd: "",
    status: "completed",
    startedAt: "2026-09-25T10:00:00Z",
    completedAt: "2026-09-25T10:05:00Z",
    output: "ok",
    result: null,
    error: null,
    pendingQuestion: null,
    ...overrides,
  } as ExecutionInfo;
}

it("shows model and effort in the runtime badge tooltip, marking automatic choices", () => {
  render(<ActivityFeed executions={[
    execution({ id: "a", runtime: "claude", model: "claude-opus-5-5", effort: "extra", effortAuto: true }),
    execution({ id: "b", runtime: "codex", model: "gpt-6-astra", effort: "minimal" }),
    execution({ id: "c", runtime: "claude", model: "claude-opus-5-5" }),
  ]} />);
  expect(screen.getByTitle("Claude · claude-opus-5-5 · Esforço: Extra high (auto)")).toBeInTheDocument();
  expect(screen.getByTitle("Codex · gpt-6-astra · Esforço: Instant")).toBeInTheDocument();
  expect(screen.getByTitle("Claude · claude-opus-5-5")).toBeInTheDocument();
});
