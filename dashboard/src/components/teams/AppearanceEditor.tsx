import { useEffect, useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { AgentAvatar } from "./AgentAvatar";
import { TEAM_COLORS, AVATAR_EMOJIS } from "../../lib/teamStyle";
import type { AgentAppearance } from "../../lib/types";

interface Props {
  agentName: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (appearance: AgentAppearance) => void;
}

export function AppearanceEditor({ agentName, open, onClose, onSaved }: Props) {
  const [appearance, setAppearance] = useState<AgentAppearance>({ color: null, emoji: null });

  useEffect(() => {
    if (!open) return;
    api.get<AgentAppearance>(`/teams/appearance/${agentName}`).then(setAppearance).catch(() => {});
  }, [open, agentName]);

  const save = async (next: AgentAppearance) => {
    setAppearance(next);
    await api.put(`/teams/appearance/${agentName}`, { color: next.color, emoji: next.emoji }).catch(() => {});
    onSaved?.(next);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Avatar · ${agentName}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AgentAvatar name={agentName} appearance={appearance} size={48} />
          <button
            onClick={() => save({ color: null, emoji: null })}
            className="text-xs px-2 py-1 rounded-md border border-border text-text-muted hover:text-text-secondary transition-colors"
          >
            Resetar (automático)
          </button>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1.5">Cor</label>
          <div className="flex flex-wrap gap-1.5">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => save({ ...appearance, color: c })}
                className={`w-7 h-7 rounded-md transition-transform hover:scale-110 ${appearance.color === c ? "ring-2 ring-white scale-110" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1.5">Emoji</label>
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_EMOJIS.map((e) => (
              <button
                key={e || "none"}
                onClick={() => save({ ...appearance, emoji: e || null })}
                className={`w-8 h-8 rounded-md text-lg flex items-center justify-center transition-colors ${
                  (appearance.emoji ?? "") === e ? "bg-accent/20 ring-1 ring-accent" : "bg-bg hover:bg-surface-hover"
                }`}
              >
                {e || "–"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
