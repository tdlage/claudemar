import { describe, expect, it } from "vitest";
import { defaultEffortFor, effortLabel, effortOptionsFor, normalizeEffortFor, normalizeEffortSelection } from "./effortOptions";

describe("provider effort options", () => {
  it("uses the Claude.ai effort levels", () => {
    expect(effortOptionsFor("claude").map((option) => option.label)).toEqual([
      "Low", "Medium", "High", "Extra high", "Max", "Ultracode",
    ]);
    expect(defaultEffortFor("claude")).toBe("high");
  });

  it("uses the ChatGPT thinking levels", () => {
    expect(effortOptionsFor("codex").map((option) => option.label)).toEqual([
      "Instant", "Medium", "High", "Extra High", "Max",
    ]);
    expect(defaultEffortFor("codex")).toBe("medium");
  });

  it("normalizes legacy levels when the provider changes", () => {
    expect(normalizeEffortFor("codex", "ultracode")).toBe("max");
    expect(normalizeEffortFor("codex", "low")).toBe("minimal");
    expect(normalizeEffortFor("claude", "minimal")).toBe("low");
    expect(normalizeEffortFor("claude", "ultracode")).toBe("ultracode");
    expect(normalizeEffortFor("codex", "max")).toBe("max");
  });

  it("offers Auto only when complexity assessment is available", () => {
    expect(effortOptionsFor("claude", true)[0].value).toBe("auto");
    expect(effortOptionsFor("codex", true).map((option) => option.label)).toEqual([
      "Auto", "Instant", "Medium", "High", "Extra High", "Max",
    ]);
    expect(normalizeEffortSelection("claude", "auto", true)).toBe("auto");
    expect(normalizeEffortSelection("claude", "auto", false)).toBe("high");
    expect(normalizeEffortSelection("codex", "auto", false)).toBe("medium");
    expect(normalizeEffortSelection("codex", "ultracode", true)).toBe("max");
    expect(effortLabel("claude", "extra")).toBe("Extra high");
    expect(effortLabel("codex", "minimal")).toBe("Instant");
  });
});
