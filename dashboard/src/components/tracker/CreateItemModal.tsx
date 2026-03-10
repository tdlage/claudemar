import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "../shared/Modal";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  cycleId: string;
}

export function CreateItemModal({ open, onClose, cycleId }: Props) {
  const { addToast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [appetite, setAppetite] = useState(7);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/items", {
        cycleId,
        title: title.trim(),
        description,
        appetite,
        tags,
      });
      addToast("success", "Item created");
      setTitle("");
      setDescription("");
      setAppetite(7);
      setTags([]);
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Item">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Item title"
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Description</label>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            placeholder="Description..."
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Appetite (days)</label>
          <input
            type="number"
            min={1}
            max={365}
            value={appetite}
            onChange={(e) => setAppetite(Math.max(1, Number(e.target.value) || 1))}
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Tags</label>
          <div className="flex gap-1 flex-wrap mb-1">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-border text-text-secondary">
                {tag}
                <button onClick={() => setTags(tags.filter((t) => t !== tag))} className="hover:text-danger">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addTag(); }
            }}
            placeholder="Add tag and press Enter"
            className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
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
