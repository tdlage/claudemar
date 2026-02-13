import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  LayoutDashboard,
  Bot,
  FolderGit2,
  ScrollText,
} from "lucide-react";
import { api } from "../lib/api";
import type { AgentInfo, ProjectInfo } from "../lib/types";

interface CommandItem {
  id: string;
  label: string;
  category: string;
  icon: typeof Search;
  action: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
      api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const items: CommandItem[] = useMemo(() => {
    const result: CommandItem[] = [
      {
        id: "nav:overview",
        label: "Overview",
        category: "Navigation",
        icon: LayoutDashboard,
        action: () => {
          navigate("/");
          close();
        },
      },
      {
        id: "nav:logs",
        label: "Logs",
        category: "Navigation",
        icon: ScrollText,
        action: () => {
          navigate("/logs");
          close();
        },
      },
    ];

    for (const agent of agents) {
      result.push({
        id: `agent:${agent.name}`,
        label: agent.name,
        category: "Agents",
        icon: Bot,
        action: () => {
          navigate(`/agents/${agent.name}`);
          close();
        },
      });
    }

    for (const project of projects) {
      result.push({
        id: `project:${project.name}`,
        label: project.name,
        category: "Projects",
        icon: FolderGit2,
        action: () => {
          navigate(`/projects/${project.name}`);
          close();
        },
      });
    }

    return result;
  }, [agents, projects, navigate, close]);

  const filtered = useMemo(() => {
    if (!query) return items;
    return items.filter(
      (item) =>
        fuzzyMatch(query, item.label) || fuzzyMatch(query, item.category),
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[selectedIndex]?.action();
      }
    },
    [filtered, selectedIndex],
  );

  if (!open) return null;

  let currentCategory = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/60" onClick={close} />
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <kbd className="text-[10px] text-text-muted border border-border rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[300px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">
              No results found
            </p>
          ) : (
            filtered.map((item, index) => {
              const showCategory = item.category !== currentCategory;
              currentCategory = item.category;
              const Icon = item.icon;

              return (
                <div key={item.id}>
                  {showCategory && (
                    <p className="px-4 pt-2 pb-1 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                      {item.category}
                    </p>
                  )}
                  <button
                    data-index={index}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ${
                      index === selectedIndex
                        ? "bg-accent/10 text-accent"
                        : "text-text-secondary hover:bg-surface-hover"
                    }`}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[10px] text-text-muted">
          <span>
            <kbd className="border border-border rounded px-1 py-0.5">↑↓</kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="border border-border rounded px-1 py-0.5">↵</kbd>{" "}
            select
          </span>
          <span>
            <kbd className="border border-border rounded px-1 py-0.5">esc</kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
}
