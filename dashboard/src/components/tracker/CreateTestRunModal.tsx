import { useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { MediaUpload, type MediaFile } from "./MediaUpload";
import type { TestRunStatus } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  testCaseId: string;
}

const STATUS_OPTIONS: { value: TestRunStatus; label: string; icon: string; color: string }[] = [
  { value: "passed", label: "Passed", icon: "✓", color: "text-success" },
  { value: "failed", label: "Failed", icon: "✗", color: "text-danger" },
  { value: "blocked", label: "Blocked", icon: "⊘", color: "text-warning" },
  { value: "skipped", label: "Skipped", icon: "—", color: "text-text-muted" },
];

export function CreateTestRunModal({ open, onClose, testCaseId }: Props) {
  const { addToast } = useToast();
  const [status, setStatus] = useState<TestRunStatus>("passed");
  const [notes, setNotes] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const run = await api.post<{ id: string }>("/tracker/test-runs", {
        testCaseId,
        status,
        notes,
        durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
      });
      if (files.length > 0) {
        for (const f of files) {
          await api.post(`/tracker/test-runs/${run.id}/attachments`, {
            base64: f.base64,
            filename: f.filename,
            mimeType: f.mimeType,
          });
        }
      }
      addToast("success", "Test run recorded");
      setStatus("passed");
      setNotes("");
      setDurationSeconds("");
      setFiles([]);
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create test run");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Test Run">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Status</label>
          <div className="flex gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors ${
                  status === opt.value
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/30"
                }`}
              >
                <span className={opt.color}>{opt.icon}</span>
                <span className="text-text-primary">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observations, failure reason, etc."
            rows={3}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Duration (seconds)</label>
          <input
            type="number"
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(e.target.value)}
            placeholder="Optional"
            min={0}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Attachments</label>
          <MediaUpload files={files} onChange={setFiles} acceptVideo />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Saving..." : "Record Run"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
