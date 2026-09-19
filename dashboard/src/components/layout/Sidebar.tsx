import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Crown,
  Brain,
  Bot,
  Folder,
  ScrollText,
  GitCommitHorizontal,
  Users,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  KanbanSquare,
  ArrowUpRight,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth, getMe } from "../../hooks/useAuth";
import { TokenUsage } from "./TokenUsage";
import { useSocketEvent, useSocketRoom } from "../../hooks/useSocket";
import type { AgentInfo, ProjectInfo, ExecutionInfo } from "../../lib/types";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { Brand } from "../shared/Brand";
import {
  WORKSPACES_CHANGED_EVENT,
  openCreateWorkspace,
} from "../../lib/workspaceEvents";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  isMobile: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  isMobile: false,
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const saved = localStorage.getItem("claudemar_sidebar");
      if (saved !== null) return saved === "collapsed";
    } catch {
      /* Storage may be unavailable. */
    }
    return window.innerWidth < 1200;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const mqCollapse = window.matchMedia("(max-width: 1199px)");
    const mqMobile = window.matchMedia("(max-width: 767px)");
    const handleCollapse = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    const handleMobile = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (e.matches) setMobileOpen(false);
    };
    mqCollapse.addEventListener("change", handleCollapse);
    mqMobile.addEventListener("change", handleMobile);
    return () => {
      mqCollapse.removeEventListener("change", handleCollapse);
      mqMobile.removeEventListener("change", handleMobile);
    };
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        setCollapsed: (value) => {
          setCollapsed(value);
          try {
            localStorage.setItem(
              "claudemar_sidebar",
              value ? "collapsed" : "expanded",
            );
          } catch {
            /* Keep navigation usable without storage. */
          }
        },
        mobileOpen,
        setMobileOpen,
        isMobile,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

type TargetStatus = Record<
  string,
  { running: boolean; lastStatus: "completed" | "error" | "cancelled" | null }
>;

function StatusDot({ status }: { status?: TargetStatus[string] }) {
  const label = status?.running
    ? "Em execução"
    : status?.lastStatus === "error"
      ? "Última execução falhou"
      : "Sem execução em andamento";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`status-dot ${status?.running ? "is-running" : status?.lastStatus === "error" ? "bg-danger" : "bg-border-hover"}`}
    />
  );
}

export function Sidebar() {
  const { logout } = useAuth();
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen, isMobile } =
    useSidebar();
  const sidebarRef = useRef<HTMLElement>(null);
  useDialogFocus(sidebarRef, isMobile && mobileOpen, () =>
    setMobileOpen(false),
  );
  const me = getMe();
  const admin = !me || me.role === "admin";
  const location = useLocation();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [targetStatus, setTargetStatus] = useState<TargetStatus>({});
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        api.get<AgentInfo[]>("/agents"),
        api.get<ProjectInfo[]>("/projects"),
      ]);
      setAgents(a);
      setProjects(p);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    api
      .get<TargetStatus>("/executions/target-status")
      .then(setTargetStatus)
      .catch(() => {});
    window.addEventListener(WORKSPACES_CHANGED_EVENT, load);
    return () => window.removeEventListener(WORKSPACES_CHANGED_EVENT, load);
  }, [load]);
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [location.pathname, isMobile, setMobileOpen]);
  const update = useCallback((info: ExecutionInfo, running: boolean) => {
    if (info.targetType === "project") {
      setProjects((previous) => previous.map((project) =>
        project.name === info.targetName && info.startedAt > (project.lastUsedAt ?? "")
          ? { ...project, lastUsedAt: info.startedAt }
          : project,
      ));
    }
    const key = `${info.targetType}:${info.targetName}`;
    setTargetStatus((prev) => ({
      ...prev,
      [key]: {
        running,
        lastStatus: running
          ? (prev[key]?.lastStatus ?? null)
          : (info.status as "completed" | "error" | "cancelled"),
      },
    }));
  }, []);
  useSocketEvent<{ info: ExecutionInfo }>("execution:start", ({ info }) =>
    update(info, true),
  );
  useSocketEvent<{ info: ExecutionInfo; hasQueued?: boolean }>(
    "execution:complete",
    ({ info, hasQueued }) => {
      update(info, !!hasQueued);
      void load();
    },
  );
  useSocketEvent<{ info: ExecutionInfo; hasQueued?: boolean }>(
    "execution:error",
    ({ info, hasQueued }) => {
      update(info, !!hasQueued);
      void load();
    },
  );
  useSocketEvent<{ info: ExecutionInfo; hasQueued?: boolean }>(
    "execution:cancel",
    ({ info, hasQueued }) => {
      update(info, !!hasQueued);
      void load();
    },
  );
  useSocketRoom("files");
  const fileChangeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(fileChangeTimer.current), []);
  useSocketEvent<{ base: string }>("file:changed", ({ base }) => {
    if (!base.startsWith("project:")) return;
    clearTimeout(fileChangeTimer.current);
    fileChangeTimer.current = setTimeout(load, 2000);
  });
  const expanded = isMobile || !collapsed;
  const recentProjects = [...projects].sort((a, b) =>
    (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.name.localeCompare(b.name, "pt-BR"),
  );
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar-link ${isActive ? "is-active" : ""} ${expanded ? "" : "is-compact"}`;
  if (isMobile && !mobileOpen) return null;
  return (
    <>
      {isMobile && (
        <div
          className="fixed inset-0 bg-black/60 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile ? true : undefined}
        aria-label="Menu de navegação"
        tabIndex={-1}
        className={`app-sidebar ${expanded ? "is-expanded" : "is-collapsed"}`}
      >
        <div className="sidebar-brand">
          {expanded && (
            <Link
              to={admin ? "/" : "/workspaces"}
              aria-label="Claudemar — início"
            >
              <Brand />
            </Link>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              isMobile ? setMobileOpen(false) : setCollapsed(!collapsed)
            }
            title={
              isMobile
                ? "Fechar menu"
                : collapsed
                  ? "Expandir menu"
                  : "Recolher menu"
            }
            aria-label={
              isMobile
                ? "Fechar menu"
                : collapsed
                  ? "Expandir menu"
                  : "Recolher menu"
            }
          >
            {collapsed && !isMobile ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <div className="sidebar-group">
            {expanded && <p className="sidebar-label">Workspace</p>}
            <NavLink
              to={admin ? "/" : "/workspaces"}
              end
              className={linkClass}
              title="Visão geral"
            >
              <LayoutDashboard size={18} />
              {expanded && "Visão geral"}
            </NavLink>
            {admin && (
              <NavLink
                to="/orchestrator"
                className={linkClass}
                title="Assistente"
              >
                <Crown size={18} />
                {expanded && (
                  <>
                    <span className="flex-1">Assistente</span>
                    <StatusDot
                      status={targetStatus["orchestrator:orchestrator"]}
                    />
                  </>
                )}
              </NavLink>
            )}
            <NavLink
              to="/workspaces/projects"
              className={linkClass}
              title="Projetos"
            >
              <Folder size={18} />
              {expanded && (
                <>
                  <span className="flex-1">Projetos</span>
                  <span className="nav-count">
                    {loading ? "–" : projects.length}
                  </span>
                </>
              )}
            </NavLink>
            <NavLink
              to="/workspaces/agents"
              className={linkClass}
              title="Agentes"
            >
              <Bot size={18} />
              {expanded && (
                <>
                  <span className="flex-1">Agentes</span>
                  <span className="nav-count">
                    {loading ? "–" : agents.length}
                  </span>
                </>
              )}
            </NavLink>
            <NavLink to="/tracker" className={linkClass} title="Tarefas">
              <KanbanSquare size={18} />
              {expanded && "Tarefas"}
            </NavLink>
            {admin && (
              <NavLink
                to="/second-brain"
                className={linkClass}
                title="Second Brain"
              >
                <Brain size={18} />
                {expanded && "Second Brain"}
              </NavLink>
            )}
          </div>
          {expanded && (
            <>
              <div className="sidebar-group">
                <div className="sidebar-section-heading">
                  <span className="sidebar-label">Seus projetos</span>
                  {admin && (
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={() => openCreateWorkspace("projects")}
                      aria-label="Novo projeto"
                      title="Novo projeto"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
                {recentProjects.slice(0, 6).map((p) => (
                  <NavLink
                    key={p.name}
                    to={`/projects/${encodeURIComponent(p.name)}`}
                    className={linkClass}
                    title={p.name}
                  >
                    <span className="workspace-initial">
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="truncate flex-1">{p.name}</span>
                    {p.hasChanges && (
                      <span
                        role="img"
                        aria-label="Alterações pendentes de commit"
                        title="Alterações pendentes de commit"
                        className="inline-flex shrink-0 items-center rounded border border-warning/30 bg-warning/10 p-1 text-warning"
                      >
                        <GitCommitHorizontal size={14} aria-hidden="true" />
                      </span>
                    )}
                    <StatusDot status={targetStatus[`project:${p.name}`]} />
                  </NavLink>
                ))}
                {!projects.length && (
                  <p className="sidebar-hint">
                    {loading
                      ? "Carregando…"
                      : loadError
                        ? "Projetos indisponíveis."
                        : "Seus projetos aparecerão aqui."}
                  </p>
                )}
                {projects.length > 6 && (
                  <Link className="sidebar-more" to="/workspaces/projects">
                    Ver todos os projetos <ArrowUpRight size={13} />
                  </Link>
                )}
              </div>
              <div className="sidebar-group">
                <div className="sidebar-section-heading">
                  <span className="sidebar-label">Seus agentes</span>
                  {admin && (
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={() => openCreateWorkspace("agents")}
                      aria-label="Novo agente"
                      title="Novo agente"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
                {agents.slice(0, 4).map((a) => (
                  <NavLink
                    key={a.name}
                    to={`/agents/${encodeURIComponent(a.name)}`}
                    className={linkClass}
                    title={a.name}
                  >
                    <Bot size={16} />
                    <span className="truncate flex-1">{a.name}</span>
                    <StatusDot status={targetStatus[`agent:${a.name}`]} />
                  </NavLink>
                ))}
                {!agents.length && (
                  <p className="sidebar-hint">
                    {loading
                      ? "Carregando…"
                      : loadError
                        ? "Agentes indisponíveis."
                        : "Crie agentes para tarefas recorrentes."}
                  </p>
                )}
                {agents.length > 4 && (
                  <Link className="sidebar-more" to="/workspaces/agents">
                    Ver todos os agentes <ArrowUpRight size={13} />
                  </Link>
                )}
              </div>
              {loadError && (
                <button
                  type="button"
                  className="sidebar-more text-warning"
                  onClick={() => void load()}
                >
                  Não foi possível carregar. Tentar novamente
                </button>
              )}
            </>
          )}
          {admin && (
            <div className="sidebar-group sidebar-admin">
              {expanded && <p className="sidebar-label">Administração</p>}
              <NavLink
                to="/users"
                className={linkClass}
                title="Pessoas e acessos"
              >
                <Users size={17} />
                {expanded && "Pessoas e acessos"}
              </NavLink>
              <NavLink
                to="/settings"
                className={linkClass}
                title="Configurações"
              >
                <Settings size={17} />
                {expanded && "Configurações"}
              </NavLink>
              <NavLink to="/logs" className={linkClass} title="Logs do sistema">
                <ScrollText size={17} />
                {expanded && "Logs do sistema"}
              </NavLink>
              <NavLink to="/changelog" className={linkClass} title="Novidades">
                <GitCommitHorizontal size={17} />
                {expanded && "Novidades"}
              </NavLink>
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          {admin && expanded && (
            <details className="usage-disclosure">
              <summary>Uso de recursos</summary>
              <TokenUsage collapsed={false} />
            </details>
          )}
          <div className="sidebar-account">
            {expanded && (
              <>
                <span className="account-avatar">
                  {me?.role === "user"
                    ? me.name.slice(0, 1).toUpperCase()
                    : "C"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-text-primary">
                    {me?.role === "user" ? me.name : "Administrador"}
                  </span>
                  <span className="block text-[11px] text-text-muted">
                    {admin ? "Acesso completo" : "Conta pessoal"}
                  </span>
                </span>
              </>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={logout}
              aria-label="Sair da conta"
              title="Sair da conta"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
