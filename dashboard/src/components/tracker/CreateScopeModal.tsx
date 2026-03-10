import { useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  betId: string;
}

export function CreateScopeModal({ open, onClose, betId }: Props) {
  const { addToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/scopes", { betId, title: title.trim(), description });
      addToast("success", "Scope created");
      setTitle("");
      setDescription("");
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create scope");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Scope">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Scope title"
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
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
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
