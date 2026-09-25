import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  LayoutDashboard,
  Bot,
  Brain,
  FolderGit2,
  ScrollText,
  Crown,
  Settings,
  Users,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { isAdmin } from "../hooks/useAuth";
import { OPEN_SEARCH_EVENT } from "../lib/workspaceEvents";
import { Modal } from "./shared/Modal";
import type { AgentInfo, ProjectInfo } from "../lib/types";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const admin = isAdmin();
  useEffect(() => {
    const show = () => {
      setQuery("");
      setSelectedIndex(0);
      setLoading(true);
      setError(false);
      setOpen(true);
    };
    const toggle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      }
    };
    window.addEventListener("keydown", toggle);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => {
      window.removeEventListener("keydown", toggle);
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 0);
    Promise.all([
      api.get<AgentInfo[]>("/agents"),
      api.get<ProjectInfo[]>("/projects"),
    ])
      .then(([a, p]) => {
        if (!cancelled) {
          setAgents(a);
          setProjects(p);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(focusTimer);
    };
  }, [open]);
  const items = useMemo(
    () => [
      {
        id: "home",
        label: "Visão geral",
        category: "Navegação",
        icon: LayoutDashboard,
        to: admin ? "/" : "/workspaces",
      },
      {
        id: "projects",
        label: "Projetos",
        category: "Navegação",
        icon: FolderGit2,
        to: "/workspaces/projects",
      },
      {
        id: "agents",
        label: "Agentes",
        category: "Navegação",
        icon: Bot,
        to: "/workspaces/agents",
      },
      ...(admin
        ? [
            {
              id: "assistant",
              label: "Assistente",
              category: "Navegação",
              icon: Crown,
              to: "/orchestrator",
            },
            {
              id: "brain",
              label: "Second Brain",
              category: "Navegação",
              icon: Brain,
              to: "/second-brain",
            },
            {
              id: "settings",
              label: "Configurações",
              category: "Navegação",
              icon: Settings,
              to: "/settings",
            },
            {
              id: "users",
              label: "Pessoas e acessos",
              category: "Navegação",
              icon: Users,
              to: "/users",
            },
            {
              id: "logs",
              label: "Logs do sistema",
              category: "Navegação",
              icon: ScrollText,
              to: "/logs",
            },
          ]
        : []),
      ...projects.map((p) => ({
        id: `project:${p.name}`,
        label: p.name,
        category: "Projetos",
        icon: FolderGit2,
        to: `/projects/${encodeURIComponent(p.name)}`,
      })),
      ...agents.map((a) => ({
        id: `agent:${a.name}`,
        label: a.name,
        category: "Agentes",
        icon: Bot,
        to: `/agents/${encodeURIComponent(a.name)}`,
      })),
    ],
    [admin, agents, projects],
  );
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const filtered = items.filter((item) =>
    normalize(`${item.label} ${item.category}`).includes(
      normalize(query.trim()),
    ),
  );
  const selected = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Buscar no workspace"
      size="lg"
    >
      <div className="search-field !w-full">
        <Search size={18} />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Buscar páginas, projetos e agentes"
          aria-expanded="true"
          aria-controls="workspace-search-results"
          aria-autocomplete="list"
          aria-activedescendant={
            filtered[selected] ? `search-result-${selected}` : undefined
          }
          placeholder="Digite o nome de uma página, projeto ou agente…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedIndex(
                (selected +
                  (e.key === "ArrowDown" ? 1 : -1) +
                  filtered.length) %
                  Math.max(1, filtered.length),
              );
            }
            if (
              e.key === "Enter" &&
              !e.nativeEvent.isComposing &&
              filtered[selected]
            ) {
              e.preventDefault();
              go(filtered[selected].to);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button small"
            aria-label="Limpar busca"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {loading && (
        <p role="status" className="text-xs text-text-muted py-3">
          Carregando projetos e agentes…
        </p>
      )}
      {error && (
        <p role="status" className="text-xs text-warning py-3">
          Projetos e agentes indisponíveis. As páginas continuam acessíveis
          abaixo.
        </p>
      )}
      <div
        ref={listRef}
        id="workspace-search-results"
        role="listbox"
        aria-label="Resultados da busca"
        className="command-results"
      >
        {filtered.map((item, index) => (
          <div
            key={item.id}
            id={`search-result-${index}`}
            role="option"
            aria-selected={selected === index}
            data-index={index}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => go(item.to)}
            className={`command-result ${selected === index ? "is-selected" : ""}`}
          >
            <item.icon size={17} />
            <span>{item.label}</span>
            <small>{item.category}</small>
          </div>
        ))}
      </div>
      {!filtered.length && (
        <p role="status" className="text-center text-sm text-text-muted py-8">
          Nenhum resultado. Tente outro nome.
        </p>
      )}
      <p className="command-search-help">
        <span>
          <kbd>↑ ↓</kbd> navegar
        </span>
        <span>
          <kbd>Enter</kbd> abrir
        </span>
        <span>
          <kbd>Esc</kbd> fechar
        </span>
      </p>
    </Modal>
  );
}
