import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil, Clock } from "lucide-react";
import { Tabs } from "../shared/Tabs";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useItems, useTrackerProjects } from "../../hooks/useTracker";
import { canEditTrackerProject } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { TestCasePanel } from "./TestCasePanel";
import { CommentThread } from "./CommentThread";
import { getDaysSpent, ITEM_PRIORITIES, getPriorityConfig } from "./constants";

interface Props {
  projectId: string;
  cycleId: string;
  itemId: string;
}

type TabKey = "details" | "tests" | "comments";

function AppetiteIndicator({ appetite, startedAt }: { appetite: number; startedAt: string | null }) {
  if (!startedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-border text-text-muted">
        <Clock size={12} />
        {appetite}d
      </span>
    );
  }

  const daysSpent = getDaysSpent(startedAt);
  const ratio = daysSpent / appetite;
  const pct = Math.min(ratio * 100, 100);

  let colorClass: string;
  let barColor: string;
  if (daysSpent > appetite) {
    colorClass = "text-danger bg-danger/10";
    barColor = "bg-danger";
  } else if (daysSpent === appetite) {
    colorClass = "text-warning bg-warning/10";
    barColor = "bg-warning";
  } else {
    colorClass = "text-success bg-success/10";
    barColor = "bg-success";
  }

  return (
    <span className={`inline-flex items-center gap-2 px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      <span className="relative w-16 h-2 rounded-full bg-current/20 overflow-hidden">
        <span className={`absolute inset-y-0 left-0 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </span>
      {daysSpent}/{appetite}d
    </span>
  );
}

export function ItemDetail({ projectId, cycleId, itemId }: Props) {
  const { addToast } = useToast();
  const canEdit = canEditTrackerProject(projectId);
  const { projects } = useTrackerProjects();
  const { items } = useItems(cycleId);
  const project = projects.find((p) => p.id === projectId);
  const [tab, setTab] = useState<TabKey>("details");
  const [editingItem, setEditingItem] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
  const [editingAppetite, setEditingAppetite] = useState(false);
  const [appetiteValue, setAppetiteValue] = useState(7);
  const [description, setDescription] = useState("");
  const [inScope, setInScope] = useState("");
  const [outOfScope, setOutOfScope] = useState("");
  const descriptionSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionInitRef = useRef(false);

  const item = items.find((i) => i.id === itemId);

  useEffect(() => {
    if (item) {
      setInScope(item.inScope);
      setOutOfScope(item.outOfScope);
    }
  }, [item?.inScope, item?.outOfScope]);

  useEffect(() => {
    if (item && !descriptionInitRef.current) {
      setDescription(item.description);
      descriptionInitRef.current = true;
    }
  }, [item]);

  useEffect(() => {
    if (item && item.description !== description && descriptionInitRef.current) {
      setDescription(item.description);
    }
  }, [item?.description]);

  const handleDescriptionChange = useCallback((md: string) => {
    setDescription(md);
    if (descriptionSaveRef.current) clearTimeout(descriptionSaveRef.current);
    descriptionSaveRef.current = setTimeout(async () => {
      try {
        await api.put(`/tracker/items/${itemId}`, { description: md });
      } catch {
        addToast("error", "Failed to save description");
      }
    }, 1000);
  }, [itemId, addToast]);

  const handleSaveDescription = useCallback(async () => {
    if (descriptionSaveRef.current) {
      clearTimeout(descriptionSaveRef.current);
      descriptionSaveRef.current = null;
    }
    try {
      await api.put(`/tracker/items/${itemId}`, { description });
    } catch {
      addToast("error", "Failed to save description");
    }
  }, [itemId, description, addToast]);

  const handleSaveItemTitle = async () => {
    if (!itemTitle.trim()) return;
    try {
      await api.put(`/tracker/items/${itemId}`, { title: itemTitle.trim() });
      setEditingItem(false);
    } catch {
      addToast("error", "Failed to update item");
    }
  };

  const handleSavePriority = async (value: string | null) => {
    try {
      await api.put(`/tracker/items/${itemId}`, { priority: value });
    } catch {
      addToast("error", "Failed to update priority");
    }
  };

  const handleSaveAppetite = async () => {
    const val = Math.max(1, appetiteValue);
    try {
      await api.put(`/tracker/items/${itemId}`, { appetite: val });
      setEditingAppetite(false);
    } catch {
      addToast("error", "Failed to update appetite");
    }
  };

  const handleSaveInScope = async () => {
    try {
      await api.put(`/tracker/items/${itemId}`, { inScope });
    } catch {
      addToast("error", "Failed to save");
    }
  };

  const handleSaveOutOfScope = async () => {
    try {
      await api.put(`/tracker/items/${itemId}`, { outOfScope });
    } catch {
      addToast("error", "Failed to save");
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "details", label: "Detalhes" },
    { key: "tests", label: "Tests" },
    { key: "comments", label: "Comments" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Link to="/tracker" className="hover:text-text-primary transition-colors">Tracker</Link>
        <span>/</span>
        <Link to={`/tracker/${projectId}`} className="hover:text-text-primary transition-colors">Project</Link>
        <span>/</span>
        <Link to={`/tracker/${projectId}/cycles/${cycleId}`} className="hover:text-text-primary transition-colors">Cycle</Link>
        <span>/</span>
        <span className="text-text-primary">{item?.title ?? "Item"}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/tracker/${projectId}/cycles/${cycleId}`} className="text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft size={16} />
          </Link>
          {project && item && item.seqNumber > 0 && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent">
              {project.code}-{item.seqNumber}
            </span>
          )}
          {editingItem ? (
            <input
              value={itemTitle}
              onChange={(e) => setItemTitle(e.target.value)}
              onBlur={handleSaveItemTitle}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveItemTitle(); if (e.key === "Escape") setEditingItem(false); }}
              autoFocus
              className="bg-bg border border-border rounded px-2 py-1 text-lg font-semibold text-text-primary focus:outline-none focus:border-accent"
            />
          ) : (
            <h2 className="text-lg font-semibold text-text-primary">{item?.title ?? "Item"}</h2>
          )}
          {item && (() => {
            const pc = getPriorityConfig(item.priority);
            return pc ? (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${pc.color}`}>
                {pc.label}
              </span>
            ) : canEdit ? (
              <button
                onClick={() => handleSavePriority("P3")}
                className="text-[10px] text-text-muted hover:text-accent"
                title="Set priority"
              >
                + priority
              </button>
            ) : null;
          })()}
          {item && canEdit && item.priority && (
            <select
              value={item.priority}
              onChange={(e) => handleSavePriority(e.target.value || null)}
              className="bg-bg border border-border rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">Sem prioridade</option>
              {ITEM_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          )}
          {item && !editingAppetite && (
            <button
              onClick={() => { if (canEdit) { setAppetiteValue(item.appetite); setEditingAppetite(true); } }}
              className={canEdit ? "cursor-pointer" : "cursor-default"}
              title={canEdit ? "Click to edit appetite" : undefined}
            >
              <AppetiteIndicator appetite={item.appetite} startedAt={item.startedAt} />
            </button>
          )}
          {editingAppetite && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={365}
                value={appetiteValue}
                onChange={(e) => setAppetiteValue(Math.max(1, Number(e.target.value) || 1))}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveAppetite(); if (e.key === "Escape") setEditingAppetite(false); }}
                autoFocus
                className="w-16 bg-bg border border-border rounded px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              />
              <span className="text-xs text-text-muted">days</span>
            </div>
          )}
          {canEdit && !editingItem && (
            <button
              onClick={() => { setItemTitle(item?.title ?? ""); setEditingItem(true); }}
              className="text-text-muted hover:text-text-primary"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>

      {item?.assignees && item.assignees.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted mr-1">Assignees:</span>
          {item.assignees.map((a) => (
            <span
              key={a}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-accent/10 text-accent"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "details" && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Descrição</label>
            <MarkdownEditor
              value={description}
              onChange={handleDescriptionChange}
              onSave={handleSaveDescription}
              placeholder="Descrição do item..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">In Scope</label>
            <textarea
              value={inScope}
              onChange={(e) => setInScope(e.target.value)}
              onBlur={handleSaveInScope}
              rows={4}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
              placeholder="O que faz parte do escopo deste item..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1 uppercase tracking-wider">Out of Scope</label>
            <textarea
              value={outOfScope}
              onChange={(e) => setOutOfScope(e.target.value)}
              onBlur={handleSaveOutOfScope}
              rows={4}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
              placeholder="O que NÃO faz parte do escopo deste item..."
            />
          </div>
        </div>
      )}

      {tab === "tests" && (
        <TestCasePanel targetType="item" targetId={itemId} />
      )}

      {tab === "comments" && (
        <CommentThread targetType="item" targetId={itemId} />
      )}
    </div>
  );
}
