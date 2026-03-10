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
  const [appetite, setAppetite] = useState(7);
  const [inScope, setInScope] = useState("");
  const [outOfScope, setOutOfScope] = useState("");
  const [description, setDescription] = useState("");
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

  const reset = () => {
    setTitle("");
    setAppetite(7);
    setInScope("");
    setOutOfScope("");
    setDescription("");
    setTags([]);
    setTagInput("");
  };

  const handleSave = async () => {
    if (!title.trim() || !description.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/items", {
        cycleId,
        title: title.trim(),
        appetite,
        inScope,
        outOfScope,
        description,
        tags,
      });
      addToast("success", "Item created");
      reset();
      onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Item" size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-4">
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
            <label className="block text-xs text-text-muted mb-1">Appetite (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={appetite}
              onChange={(e) => setAppetite(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Description</label>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            placeholder="Descrição do item..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1">In Scope</label>
            <MarkdownEditor
              value={inScope}
              onChange={setInScope}
              placeholder="O que faz parte do escopo..."
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Out of Scope</label>
            <MarkdownEditor
              value={outOfScope}
              onChange={setOutOfScope}
              placeholder="O que NÃO faz parte do escopo..."
            />
          </div>
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

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !description.trim() || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
