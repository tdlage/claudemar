import { useState } from "react";
import { X, Bug, Layers } from "lucide-react";
import { Modal } from "../shared/Modal";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { useProjectMembers } from "../../hooks/useTracker";
import { ITEM_PRIORITIES } from "./constants";
import type { ItemType, TrackerCycle } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  cycleId?: string;
  cycleType?: "features" | "bugs";
  projectId: string;
  cycles?: TrackerCycle[];
}

export function CreateItemModal({ open, onClose, cycleId, cycleType, projectId, cycles }: Props) {
  const { addToast } = useToast();
  const { members } = useProjectMembers(projectId);
  const [title, setTitle] = useState("");
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const defaultType: ItemType = cycleType === "bugs" ? "bug" : "feature";
  const [itemType, setItemType] = useState<ItemType>(defaultType);
  const [appetite, setAppetite] = useState(7);
  const [priority, setPriority] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [inScope, setInScope] = useState("");
  const [outOfScope, setOutOfScope] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleAssignee = (id: string) => {
    setAssignees((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const resolvedCycleId = cycleId || selectedCycleId;

  const reset = () => {
    setTitle("");
    if (!cycleId) setSelectedCycleId("");
    setItemType(defaultType);
    setAppetite(7);
    setPriority("");
    setAssignees([]);
    setInScope("");
    setOutOfScope("");
    setDescription("");
    setTags([]);
    setTagInput("");
  };

  const handleSave = async (keepOpen: boolean) => {
    if (!title.trim() || !description.trim() || !resolvedCycleId || saving) return;
    setSaving(true);
    try {
      await api.post("/tracker/items", {
        cycleId: resolvedCycleId,
        title: title.trim(),
        type: itemType,
        appetite,
        priority: priority || undefined,
        assignees: assignees.length > 0 ? assignees : undefined,
        inScope,
        outOfScope,
        description,
        tags,
      });
      addToast("success", "Item created");
      reset();
      if (!keepOpen) onClose();
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Item" size="xl">
      <div className="space-y-4">
        {!cycleId && cycles && cycles.length > 0 && (
          <div>
            <label className="block text-xs text-text-muted mb-1">Cycle</label>
            <select
              value={selectedCycleId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedCycleId(id);
                const cycle = cycles?.find((c) => c.id === id);
                setItemType(cycle?.type === "bugs" ? "bug" : "feature");
              }}
              className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">Select a cycle...</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4">
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
            <label className="block text-xs text-text-muted mb-1">Type</label>
            <div className="flex rounded-md overflow-hidden border border-border h-[34px]">
              <button
                type="button"
                onClick={() => setItemType("feature")}
                className={`inline-flex items-center gap-1 px-2.5 text-xs font-medium transition-colors ${
                  itemType === "feature" ? "bg-accent text-white" : "bg-bg text-text-muted hover:text-text-primary"
                }`}
              >
                <Layers size={12} />
                Feature
              </button>
              <button
                type="button"
                onClick={() => setItemType("bug")}
                className={`inline-flex items-center gap-1 px-2.5 text-xs font-medium transition-colors ${
                  itemType === "bug" ? "bg-danger text-white" : "bg-bg text-text-muted hover:text-text-primary"
                }`}
              >
                <Bug size={12} />
                Bug
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-40 bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">Sem prioridade</option>
              {ITEM_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
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

        {members.length > 0 && (
          <div>
            <label className="block text-xs text-text-muted mb-1">Assignees</label>
            <div className="flex gap-2 flex-wrap">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleAssignee(m.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                    assignees.includes(m.id)
                      ? "bg-accent/20 text-accent border border-accent/40"
                      : "bg-bg border border-border text-text-secondary hover:border-accent/30"
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] flex items-center justify-center font-medium shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

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
            onClick={() => handleSave(true)}
            disabled={!title.trim() || !description.trim() || !resolvedCycleId || saving}
            className="px-3 py-1.5 text-xs rounded-md border border-accent text-accent hover:bg-accent/10 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Saving..." : "Save & Add Another"}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={!title.trim() || !description.trim() || !resolvedCycleId || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
