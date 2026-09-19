import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  Menu,
  RefreshCw,
  Search,
  Activity,
} from "lucide-react";
import { api } from "../../lib/api";
import { SystemResources } from "./SystemResources";
import { ProviderBadge } from "./ProviderBadge";
import { ProcessIndicator } from "./ProcessIndicator";
import { useSidebar } from "./Sidebar";
import { isAdmin } from "../../hooks/useAuth";
import { ThemeToggle } from "../shared/ThemeToggle";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { OPEN_SEARCH_EVENT } from "../../lib/workspaceEvents";
import type {
  TrackerProject,
  TrackerCycle,
  TrackerItem,
} from "../../lib/types";

export function Header() {
  const location = useLocation();
  const { isMobile, setMobileOpen } = useSidebar();
  const admin = isAdmin();
  const [reloading, setReloading] = useState(false);
  const systemRef = useRef<HTMLDetailsElement>(null);
  const { addToast } = useToast();
  const trackerNames = useTrackerBreadcrumbs(location.pathname);
  const breadcrumbs = buildBreadcrumbs(location.pathname, trackerNames);
  const title = safeDecode(breadcrumbs[breadcrumbs.length - 1]);
  useEffect(() => {
    document.title = `${title} · Claudemar`;
  }, [title]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!systemRef.current?.contains(event.target as Node))
        systemRef.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && systemRef.current?.open) {
        systemRef.current.removeAttribute("open");
        systemRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <header className="app-header">
      <div className="flex items-center gap-2 min-w-0">
        {isMobile &&
          (/^\/(projects|agents)\//.test(location.pathname) ? (
            <Link
              to={
                location.pathname.startsWith("/projects/")
                  ? "/workspaces/projects"
                  : "/workspaces/agents"
              }
              aria-label="Voltar à lista"
              className="icon-button"
            >
              <ArrowLeft size={20} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="icon-button"
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
          ))}
        <nav aria-label="Localização atual" className="breadcrumbs">
          {!isMobile && (
            <>
              <Link
                to={admin ? "/" : "/workspaces"}
                className="text-text-muted"
              >
                Workspace
              </Link>
              <ChevronRight size={12} className="shrink-0 text-text-muted" />
            </>
          )}
          {(isMobile ? breadcrumbs.slice(-1) : breadcrumbs).map(
            (crumb, i, list) => (
              <span key={i} className="flex gap-2 items-center min-w-0">
                {i > 0 && (
                  <ChevronRight
                    size={12}
                    className="shrink-0 text-text-muted"
                  />
                )}
                <span
                  aria-current={i === list.length - 1 ? "page" : undefined}
                  className={`truncate ${i === list.length - 1 ? "text-text-primary" : "text-text-muted"}`}
                >
                  {safeDecode(crumb)}
                </span>
              </span>
            ),
          )}
        </nav>
      </div>
      <div className="header-actions">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
          className="header-search"
          aria-label="Buscar páginas, projetos e agentes"
        >
          <Search size={16} />
          <span className="hidden lg:inline">Buscar no workspace</span>
          <kbd className="hidden md:inline">
            {typeof navigator !== "undefined" &&
            /Mac|iPhone|iPad/.test(navigator.platform)
              ? "⌘ K"
              : "Ctrl K"}
          </kbd>
        </button>
        {admin && (
          <details ref={systemRef} className="system-menu hidden md:block">
            <summary
              className="icon-button"
              title="Status do sistema"
              aria-label="Status do sistema"
            >
              <Activity size={18} />
            </summary>
            <div className="system-menu-panel">
              <p className="eyebrow">Sistema</p>
              <SystemResources />
              <ProviderBadge />
              <ProcessIndicator />
              <Button
                variant="secondary"
                size="sm"
                loading={reloading}
                onClick={async () => {
                  if (reloading) return;
                  setReloading(true);
                  try {
                    await api.post("/system/reload-configs");
                    addToast("success", "Configurações atualizadas.");
                  } catch {
                    addToast(
                      "error",
                      "Não foi possível atualizar as configurações. Tente novamente.",
                    );
                  } finally {
                    setReloading(false);
                  }
                }}
              >
                <RefreshCw size={14} /> Atualizar configurações
              </Button>
            </div>
          </details>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function useTrackerBreadcrumbs(pathname: string) {
  const [names, setNames] = useState<Record<string, string>>({});

  const parts = pathname.split("/").filter(Boolean);
  const isTracker = parts[0] === "tracker";
  const projectId = isTracker ? parts[1] : undefined;
  const cycleId = isTracker && parts[2] === "cycles" ? parts[3] : undefined;
  const itemId = isTracker && parts[4] === "items" ? parts[5] : undefined;

  useEffect(() => {
    if (!isTracker) return;
    const resolved: Record<string, string> = {};
    const fetches: Promise<void>[] = [];

    if (projectId && UUID_RE.test(projectId)) {
      fetches.push(
        api
          .get<TrackerProject[]>("/tracker/projects")
          .then((projects) => {
            const p = projects.find((x: TrackerProject) => x.id === projectId);
            if (p) resolved[projectId] = p.name;
          })
          .catch(() => {}),
      );
    }
    if (cycleId && UUID_RE.test(cycleId) && projectId) {
      fetches.push(
        api
          .get<TrackerCycle[]>(`/tracker/projects/${projectId}/cycles`)
          .then((cycles) => {
            const c = cycles.find((x: TrackerCycle) => x.id === cycleId);
            if (c) resolved[cycleId] = c.name;
          })
          .catch(() => {}),
      );
    }
    if (itemId && UUID_RE.test(itemId) && cycleId) {
      fetches.push(
        api
          .get<TrackerItem[]>(`/tracker/cycles/${cycleId}/items`)
          .then((items) => {
            const item = items.find((x: TrackerItem) => x.id === itemId);
            if (item) resolved[itemId] = `${item.seqNumber} - ${item.title}`;
          })
          .catch(() => {}),
      );
    }

    if (fetches.length > 0) {
      Promise.all(fetches).then(() => setNames(resolved));
    }
  }, [isTracker, projectId, cycleId, itemId]);

  return names;
}

const BRAIN_SEGMENTS: Record<string, string> = {
  "second-brain": "Second Brain",
  chat: "Conversar",
  raw: "Dados brutos",
  wiki: "Wiki",
  search: "Busca",
  state: "Estado",
  settings: "Configurações",
  log: "Log",
  quarantine: "Quarentena",
};

function buildBreadcrumbs(
  pathname: string,
  names: Record<string, string>,
): string[] {
  if (pathname === "/") return ["Visão geral"];
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "second-brain") {
    return parts.map(
      (p) =>
        BRAIN_SEGMENTS[p] ??
        (UUID_RE.test(p) ? "..." : p.charAt(0).toUpperCase() + p.slice(1)),
    );
  }
  const labels: Record<string, string> = {
    workspaces: "Espaços de trabalho",
    projects: "Projetos",
    agents: "Agentes",
    orchestrator: "Assistente",
    tracker: "Tarefas",
    cycles: "Ciclos",
    items: "Itens",
    board: "Quadro",
    logs: "Logs do sistema",
    changelog: "Novidades",
    users: "Pessoas e acessos",
    settings: "Configurações",
  };
  return parts.map((p) => names[p] || labels[p] || (UUID_RE.test(p) ? "…" : p));
}
