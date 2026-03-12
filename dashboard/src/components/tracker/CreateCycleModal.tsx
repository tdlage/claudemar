import { useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { CycleType } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function CreateCycleModal({ open, onClose, projectId }: Props) {
  const { addToast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<CycleType>("features");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/cycles", { projectId, name: name.trim(), type });
      addToast("success", "Cycle created");
      setName("");
      setType("features");
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create cycle");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo Ciclo">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. User Authentication, Payment System"
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Tipo</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("features")}
              className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                type === "features"
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-text-muted hover:border-accent/30"
              }`}
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => setType("bugs")}
              className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                type === "bugs"
                  ? "border-danger bg-danger/10 text-danger font-medium"
                  : "border-border text-text-muted hover:border-danger/30"
              }`}
            >
              Bugs
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
