import { useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
}

function addWeeks(date: string, weeks: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function CreateCycleModal({ open, onClose }: Props) {
  const { addToast } = useToast();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => addWeeks(new Date().toISOString().slice(0, 10), 6));
  const [cooldownEndDate, setCooldownEndDate] = useState(() => addWeeks(new Date().toISOString().slice(0, 10), 8));
  const [saving, setSaving] = useState(false);

  const handleStartChange = (v: string) => {
    setStartDate(v);
    setEndDate(addWeeks(v, 6));
    setCooldownEndDate(addWeeks(v, 8));
  };

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/cycles", { name: name.trim(), startDate, endDate, cooldownEndDate });
      addToast("success", "Cycle created");
      setName("");
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create cycle");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Cycle">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Cycle 1"
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-text-muted mb-1">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => handleStartChange(e.target.value)}
              className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">End (6w)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Cooldown</label>
            <input
              type="date"
              value={cooldownEndDate}
              onChange={(e) => setCooldownEndDate(e.target.value)}
              className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
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
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
