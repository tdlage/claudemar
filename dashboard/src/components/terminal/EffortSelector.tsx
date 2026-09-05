import { Check, ChevronDown } from "lucide-react";
import type { AgentRuntime } from "../../lib/types";
import { Dropdown } from "../shared/Dropdown";
import { effortOptionsFor, type Effort } from "./effortOptions";

interface EffortSelectorProps {
  runtime: AgentRuntime;
  value: Effort;
  onChange: (effort: Effort) => void;
}

export function EffortSelector({ runtime, value, onChange }: EffortSelectorProps) {
  const options = effortOptionsFor(runtime);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isOpenAi = runtime === "codex";

  return (
    <Dropdown
      align="right"
      direction="up"
      menuClassName="w-72 !rounded-xl !p-1.5"
      triggerTitle={`${isOpenAi ? "ChatGPT thinking" : "Claude effort"}: ${selected.label}`}
      triggerClassName={`inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary ${
        isOpenAi
          ? "rounded-full border border-transparent bg-border/70 hover:bg-border"
          : "rounded-lg border border-border bg-surface hover:bg-surface-hover"
      }`}
      triggerContent={
        <>
          <span>{selected.label}</span>
          <ChevronDown size={13} className="text-text-muted" />
        </>
      }
    >
      {(close) => (
        <>
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="text-sm font-semibold text-text-primary">{isOpenAi ? "Thinking" : "Effort"}</div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {isOpenAi ? "Choose how long ChatGPT reasons" : "Choose how much effort Claude uses"}
            </div>
          </div>
          <div className="space-y-0.5">
            {options.map((option) => {
              const active = option.value === selected.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-surface-hover" : "hover:bg-surface-hover"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                      {option.label}
                      {option.isDefault && (
                        <span className="rounded-full bg-border px-1.5 py-0.5 text-[9px] font-medium text-text-muted">Default</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-text-muted">{option.description}</span>
                  </span>
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {active && <Check size={14} className="text-accent" strokeWidth={2.5} />}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Dropdown>
  );
}
