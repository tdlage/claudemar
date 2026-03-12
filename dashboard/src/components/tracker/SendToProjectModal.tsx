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
}

export function SendToProjectModal({ open, onClose, item, itemCode }: Props) {
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
      });
      addToast("success", `Sent to ${selectedProject} with plan mode`);
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Send ${itemCode} to Project`}>
      <div className="space-y-4">
        {loading ? (
          <div className="text-sm text-text-muted">Loading...</div>
        ) : (
          <>
            <div>
              <label className="block text-xs text-text-muted mb-1">Project</label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Prompt (plain text)</label>
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
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!selectedProject || !prompt.trim() || sending}
                className="px-4 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send with Plan Mode"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
