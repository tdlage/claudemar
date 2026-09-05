import { describe, expect, it } from "vitest";
import { defaultEffortFor, effortOptionsFor, normalizeEffortFor } from "./effortOptions";

describe("provider effort options", () => {
  it("uses the Claude.ai effort levels", () => {
    expect(effortOptionsFor("claude").map((option) => option.label)).toEqual([
      "Low", "Medium", "High", "Extra high", "Max",
    ]);
    expect(defaultEffortFor("claude")).toBe("high");
  });

  it("uses the ChatGPT thinking levels", () => {
    expect(effortOptionsFor("codex").map((option) => option.label)).toEqual([
      "Instant", "Medium", "High", "Extra High",
    ]);
    expect(defaultEffortFor("codex")).toBe("medium");
  });

  it("normalizes legacy levels when the provider changes", () => {
    expect(normalizeEffortFor("codex", "ultracode")).toBe("extra");
    expect(normalizeEffortFor("codex", "low")).toBe("minimal");
    expect(normalizeEffortFor("claude", "minimal")).toBe("low");
    expect(normalizeEffortFor("claude", "ultracode")).toBe("max");
  });
});
