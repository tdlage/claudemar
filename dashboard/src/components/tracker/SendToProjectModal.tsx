import { useState, useEffect } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { ProjectInfo, TrackerItem } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  item: TrackerItem;
  itemCode: string;
  planMode: boolean;
}

export function SendToProjectModal({ open, onClose, item, itemCode, planMode }: Props) {
  const { addToast } = useToast();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedProject("");
    setPrompt("");
    setLoading(true);
    Promise.all([
      api.get<ProjectInfo[]>("/projects"),
      api.get<{ prompt: string }>(`/tracker/items/${item.id}/generate-prompt`),
    ])
      .then(([projs, gen]) => {
        setProjects(projs);
        setPrompt(gen.prompt);
      })
      .catch(() => addToast("error", "Failed to load projects"))
      .finally(() => setLoading(false));
  }, [open, item.id]);

  const handleSend = async () => {
    if (!selectedProject || !prompt.trim() || sending) return;
    setSending(true);
    try {
      await api.post(`/tracker/items/${item.id}/send-to-project`, {
        targetProject: selectedProject,
        prompt: prompt.trim(),
        planMode,
      });
      addToast("success", planMode
        ? `${itemCode} enviado para ${selectedProject} com plano`
        : `${itemCode} enviado para ${selectedProject}`);
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const title = planMode
    ? `Enviar ${itemCode} com Plano`
    : `Enviar ${itemCode}`;

  const buttonLabel = planMode
    ? "Enviar com Plano"
    : "Enviar";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {loading ? (
          <div className="text-sm text-text-muted">Loading...</div>
        ) : (
          <>
            <div>
              <label className="block text-xs text-text-muted mb-1">Projeto</label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Selecione um projeto...</option>
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={12}
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSend}
                disabled={!selectedProject || !prompt.trim() || sending}
                className="px-4 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                {sending ? "Enviando..." : buttonLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
