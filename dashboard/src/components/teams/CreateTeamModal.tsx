import { useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { TEAM_COLORS as COLORS, TEAM_EMOJIS as EMOJIS } from "../../lib/teamStyle";
import type { Team } from "../../lib/types";

export function CreateTeamModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (team: Team) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const team = await api.post<Team>("/teams", { name: name.trim(), description: description.trim() || undefined, color, emoji });
      setName(""); setDescription("");
      onCreated(team);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo time / squad">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-text-muted mb-1">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoFocus
            placeholder="Ex: Squad Backend"
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Descrição (opcional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que esse time faz"
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">Emoji</label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-8 h-8 rounded-md text-lg flex items-center justify-center transition-colors ${emoji === e ? "bg-accent/20 ring-1 ring-accent" : "bg-bg hover:bg-surface-hover"}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">Cor</label>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-md transition-transform ${color === c ? "ring-2 ring-white scale-110" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Criando..." : "Criar time"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
