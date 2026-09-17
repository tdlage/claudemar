import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Menu, RefreshCw, Search } from "lucide-react";
import { api } from "../../lib/api";
import { SystemResources } from "./SystemResources";
import { ProviderBadge } from "./ProviderBadge";
import { ProcessIndicator } from "./ProcessIndicator";
import { useSidebar } from "./Sidebar";
import { isAdmin } from "../../hooks/useAuth";
import type { TrackerProject, TrackerCycle, TrackerItem } from "../../lib/types";

export function Header() {
  const location = useLocation();
  const { isMobile, setMobileOpen } = useSidebar();
  const admin = isAdmin();
  const [reloading, setReloading] = useState(false);

  const trackerNames = useTrackerBreadcrumbs(location.pathname);
  const breadcrumbs = buildBreadcrumbs(location.pathname, trackerNames);

  return (
    <header className="app-header min-h-14 md:min-h-12 shrink-0 border-b border-border bg-surface/95 flex items-center justify-between gap-2 px-3 md:px-6 z-10">
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && /^\/(projects|agents)\//.test(location.pathname) ? (
          <Link to={location.pathname.startsWith("/projects/") ? "/workspaces/projects" : "/workspaces/agents"} aria-label="Voltar à lista" className="flex items-center justify-center h-11 w-11 shrink-0 rounded-xl text-text-secondary"><ArrowLeft size={21} /></Link>
        ) : isMobile && (
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors shrink-0"
            title="Open menu"
          >
            <Menu size={18} />
          </button>
        )}
        <nav aria-label="Localização atual" className="flex items-center gap-1.5 text-sm min-w-0 truncate">
          {(isMobile ? breadcrumbs.slice(-1) : breadcrumbs).map((crumb, i, list) => (
            <span key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className="text-text-muted">/</span>}
              <span
                className={
                  i === list.length - 1
                    ? "text-text-primary truncate"
                    : "text-text-muted"
                }
              >
                {safeDecode(crumb)}
              </span>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        {admin && <span className="hidden sm:block"><SystemResources /></span>}
        {admin && <span className="hidden sm:block"><ProviderBadge /></span>}
        {admin && (
          <button
            onClick={async () => {
              setReloading(true);
              try {
                await api.post("/system/reload-configs");
              } catch { }
              setTimeout(() => setReloading(false), 600);
            }}
            title="Reload configs from disk"
            className="hidden md:block p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <RefreshCw size={14} className={reloading ? "animate-spin" : ""} />
          </button>
        )}
        {admin && <ProcessIndicator />}
        <button
          onClick={() =>
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                bubbles: true,
              }),
            )
          }
          className="hidden sm:flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors border border-border rounded-md px-2.5 py-1"
        >
          <Search size={12} />
          <span>Search</span>
          <kbd className="text-[10px] border border-border rounded px-1 py-0.5">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
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
        api.get<TrackerProject[]>("/tracker/projects").then((projects) => {
          const p = projects.find((x: TrackerProject) => x.id === projectId);
          if (p) resolved[projectId] = p.name;
        }).catch(() => {}),
      );
    }
    if (cycleId && UUID_RE.test(cycleId) && projectId) {
      fetches.push(
        api.get<TrackerCycle[]>(`/tracker/projects/${projectId}/cycles`).then((cycles) => {
          const c = cycles.find((x: TrackerCycle) => x.id === cycleId);
          if (c) resolved[cycleId] = c.name;
        }).catch(() => {}),
      );
    }
    if (itemId && UUID_RE.test(itemId) && cycleId) {
      fetches.push(
        api.get<TrackerItem[]>(`/tracker/cycles/${cycleId}/items`).then((items) => {
          const item = items.find((x: TrackerItem) => x.id === itemId);
          if (item) resolved[itemId] = `${item.seqNumber} - ${item.title}`;
        }).catch(() => {}),
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

function buildBreadcrumbs(pathname: string, names: Record<string, string>): string[] {
  if (pathname === "/") return ["Overview"];
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "second-brain") {
    return parts.map((p) =>
      BRAIN_SEGMENTS[p] ?? (UUID_RE.test(p) ? "..." : p.charAt(0).toUpperCase() + p.slice(1)),
    );
  }
  return parts.map((p) => names[p] || (UUID_RE.test(p) ? "..." : p.charAt(0).toUpperCase() + p.slice(1)));
}
