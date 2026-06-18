import type { ReactNode } from "react";
import { Square } from "lucide-react";
import { Button } from "../shared/Button";
import { VoiceInput } from "../shared/VoiceInput";

interface PromptComposerProps {
  value: string;
  onChange: (updater: (prev: string) => string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isRunning: boolean;
  onStop: () => void;
  placeholder: string;
  inlineControls?: ReactNode;
  toolbar?: ReactNode;
  toolbarClassName?: string;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  isRunning,
  onStop,
  placeholder,
  inlineControls,
  toolbar,
  toolbarClassName = "flex items-center gap-2 flex-wrap",
}: PromptComposerProps) {
  const inputRow = (
    <>
      <VoiceInput onTranscription={(text) => onChange((prev) => (prev ? `${prev} ${text}` : text))} />
      <textarea
        value={value}
        onChange={(e) => {
          onChange(() => e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) onSubmit(e);
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none overflow-y-auto"
        style={{ maxHeight: 200 }}
      />
      {inlineControls}
      <Button type="submit" disabled={!value.trim()}>Send</Button>
      {isRunning && (
        <Button variant="danger" onClick={onStop}>
          <Square size={14} />
        </Button>
      )}
    </>
  );

  if (!toolbar) {
    return (
      <form onSubmit={onSubmit} className="flex gap-2 items-end">
        {inputRow}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex gap-2 items-end">{inputRow}</div>
      <div className={toolbarClassName}>{toolbar}</div>
    </form>
  );
}
