import { useState } from "react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { TestCasePriority } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  targetType: "item";
  targetId: string;
}

export function CreateTestCaseModal({ open, onClose, targetType, targetId }: Props) {
  const { addToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preconditions, setPreconditions] = useState("");
  const [steps, setSteps] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [priority, setPriority] = useState<TestCasePriority>("medium");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/test-cases", {
        targetType,
        targetId,
        title: title.trim(),
        description,
        preconditions,
        steps,
        expectedResult,
        priority,
      });
      addToast("success", "Test case created");
      setTitle("");
      setDescription("");
      setPreconditions("");
      setSteps("");
      setExpectedResult("");
      setPriority("medium");
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create test case");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Test Case">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Test case title"
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this test validates"
            rows={2}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Preconditions</label>
          <textarea
            value={preconditions}
            onChange={(e) => setPreconditions(e.target.value)}
            placeholder="Setup required before running this test"
            rows={2}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Steps</label>
          <textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={"1. Navigate to...\n2. Click on...\n3. Verify that..."}
            rows={4}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y font-mono text-xs"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Expected Result</label>
          <textarea
            value={expectedResult}
            onChange={(e) => setExpectedResult(e.target.value)}
            placeholder="What should happen when all steps are completed"
            rows={2}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TestCasePriority)}
            className="w-full bg-bg border border-border rounded-md px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">
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
