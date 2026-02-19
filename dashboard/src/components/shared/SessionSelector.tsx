import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import type { SessionData } from "../../lib/types";

interface SessionSelectorProps {
  sessionData: SessionData;
  onChange: (value: string) => Promise<void>;
  onRename: (sessionId: string, name: string) => Promise<void>;
}

export function SessionSelector({ sessionData, onChange, onRename }: SessionSelectorProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const getDisplayName = (sid: string) => {
    return sessionData.names[sid] ?? sid.slice(0, 8);
  };

  const handleRenameSubmit = async () => {
    if (!sessionData.sessionId || !renameValue.trim()) return;
    await onRename(sessionData.sessionId, renameValue.trim());
    setRenaming(false);
  };

  if (renaming && sessionData.sessionId) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") setRenaming(false);
          }}
          className="text-xs bg-surface border border-accent rounded-md px-2 py-1 text-text-primary focus:outline-none w-36"
        />
        <button
          onClick={handleRenameSubmit}
          className="p-0.5 text-accent hover:text-accent/80 transition-colors"
        >
          <Check size={12} />
        </button>
        <button
          onClick={() => setRenaming(false)}
          className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={sessionData.sessionId ?? "__new"}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs font-mono bg-surface border border-border rounded-md px-2 py-1 text-text-primary focus:outline-none focus:border-accent"
      >
        <option value="__new">New session</option>
        {sessionData.history.map((sid) => (
          <option key={sid} value={sid}>
            {getDisplayName(sid)}{sid === sessionData.sessionId ? " (active)" : ""}
          </option>
        ))}
      </select>
      {sessionData.sessionId && (
        <button
          onClick={() => {
            setRenameValue(getDisplayName(sessionData.sessionId!));
            setRenaming(true);
          }}
          title="Rename session"
          className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
