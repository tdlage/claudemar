import { useEffect, useState, useCallback } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";

interface Skill { name: string; description: string }

export function LibrarySkillsModal({ teamId, teamName, open, onClose }: { teamId: string; teamName: string; open: boolean; onClose: () => void }) {
  const [available, setAvailable] = useState<Skill[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!open) return;
    api.get<Skill[]>("/projects/claude-skills").then(setAvailable).catch(() => setAvailable([]));
    api.get<string[]>(`/teams/${teamId}/skills`).then((s) => setEnabled(new Set(s))).catch(() => setEnabled(new Set()));
  }, [open, teamId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (name: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/teams/${teamId}/skills`, { skills: [...enabled] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Biblioteca · Skills do ${teamName}`} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-text-muted">
          Selecione as skills disponíveis aos agentes deste squad. <strong>Nenhuma selecionada = todas as skills ficam disponíveis</strong> (sem filtro).
        </p>
        <div className="space-y-1 max-h-80 overflow-auto">
          {available.map((s) => (
            <label key={s.name} className="flex items-start gap-2 bg-surface border border-border rounded-md px-3 py-2 cursor-pointer hover:border-border-hover">
              <input type="checkbox" checked={enabled.has(s.name)} onChange={() => toggle(s.name)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="text-sm text-text-primary">{s.name}</span>
                {s.description && <span className="block text-xs text-text-muted truncate">{s.description}</span>}
              </span>
            </label>
          ))}
          {available.length === 0 && <p className="text-sm text-text-muted">Nenhuma skill disponível no ambiente.</p>}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">Cancelar</button>
          <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors">
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
