import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Crown,
  Bot,
  Folder,
  ScrollText,
  GitCommitHorizontal,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { useSocketEvent, useSocketRoom } from "../../hooks/useSocket";
import type { AgentInfo, ProjectInfo, ExecutionInfo } from "../../lib/types";

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
    <SidebarContext.Provider value={{ collapsed, setCollapsed, mobileOpen, setMobileOpen, isMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

type TargetStatus = Record<string, { running: boolean; lastStatus: "completed" | "error" | "cancelled" | null }>;

function StatusDot({ targetKey, statusMap }: { targetKey: string; statusMap: TargetStatus }) {
  const entry = statusMap[targetKey];
  if (entry?.running) return <span className="w-2 h-2 rounded-full bg-warning animate-pulse shrink-0" />;
  if (entry?.lastStatus === "error") return <span className="w-2 h-2 rounded-full bg-danger shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-success shrink-0" />;
}

export function Sidebar() {
  const { logout } = useAuth();
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen, isMobile } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [targetStatus, setTargetStatus] = useState<TargetStatus>({});
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const loadAgents = useCallback(() => {
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
  }, []);

  useEffect(() => {
    loadAgents();
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
    api.get<TargetStatus>("/executions/target-status").then(setTargetStatus).catch(() => {});
  }, [loadAgents]);

  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [location.pathname, isMobile, setMobileOpen]);

  const handleCreateAgent = async () => {
    if (!newAgentName.trim() || creatingAgent) return;
    setCreatingAgent(true);
    try {
      await api.post("/agents", { name: newAgentName.trim() });
      setCreateAgentOpen(false);
      setNewAgentName("");
      loadAgents();
      navigate(`/agents/${newAgentName.trim()}`);
    } catch {
      // ignore
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || creatingProject) return;
    setCreatingProject(true);
    try {
      await api.post("/projects", { name: newProjectName.trim() });
      setCreateProjectOpen(false);
      setNewProjectName("");
      loadProjects();
      navigate(`/projects/${newProjectName.trim()}`);
    } catch {
      // ignore
    } finally {
      setCreatingProject(false);
    }
  };

  const markRunning = useCallback((info: ExecutionInfo) => {
    const key = `${info.targetType}:${info.targetName}`;
    setTargetStatus((prev) => ({
      ...prev,
      [key]: { running: true, lastStatus: prev[key]?.lastStatus ?? null },
    }));
  }, []);

  const loadProjects = useCallback(() => {
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
  }, []);

  const markDone = useCallback((info: ExecutionInfo, hasQueued?: boolean) => {
    const key = `${info.targetType}:${info.targetName}`;
    setTargetStatus((prev) => ({
      ...prev,
      [key]: {
        running: hasQueued ?? false,
        lastStatus: hasQueued ? (prev[key]?.lastStatus ?? null) : (info.status as "completed" | "error" | "cancelled"),
      },
    }));
    if (info.targetType === "project") {
      loadProjects();
    }
  }, [loadProjects]);

  useSocketEvent<{ info: ExecutionInfo }>("execution:start", ({ info }) => markRunning(info));
  useSocketEvent<{ info: ExecutionInfo; hasQueued?: boolean }>("execution:complete", ({ info, hasQueued }) => markDone(info, hasQueued));
  useSocketEvent<{ info: ExecutionInfo; hasQueued?: boolean }>("execution:error", ({ info, hasQueued }) => markDone(info, hasQueued));
  useSocketEvent<{ info: ExecutionInfo; hasQueued?: boolean }>("execution:cancel", ({ info, hasQueued }) => markDone(info, hasQueued));

  useSocketRoom("files");

  const fileChangeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useSocketEvent<{ event: string; base: string; path: string }>(
    "file:changed",
    useCallback(({ base }) => {
      if (!base.startsWith("project:")) return;
      if (fileChangeTimer.current) clearTimeout(fileChangeTimer.current);
      fileChangeTimer.current = setTimeout(loadProjects, 2000);
    }, [loadProjects]),
  );

  const showExpanded = isMobile ? true : !collapsed;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
      !isMobile && collapsed ? "justify-center" : ""
    } ${
      isActive
        ? "bg-accent/15 text-accent"
        : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
    }`;

  if (isMobile && !mobileOpen) return null;

  return (
    <>
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`h-screen bg-surface border-r border-border flex flex-col fixed left-0 top-0 z-40 transition-[width] duration-200 ${
          isMobile ? "w-64" : collapsed ? "w-14" : "w-56"
        }`}
      >
        <div className="px-3 py-4 border-b border-border flex items-center justify-between min-h-[57px]">
          {showExpanded && (
            <div>
              <h1 className="text-sm font-semibold text-text-primary tracking-tight">
                Claudemar
              </h1>
              <p className="text-xs text-text-muted mt-0.5">Dashboard</p>
            </div>
          )}
          {isMobile ? (
            <button
              onClick={() => setMobileOpen(false)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title="Close sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          ) : (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
          <div className="space-y-0.5">
            <NavLink to="/" end className={linkClass} title="Overview">
              <LayoutDashboard size={16} />
              {showExpanded && "Overview"}
            </NavLink>
            <NavLink to="/orchestrator" className={linkClass} title="Claudemar">
              <Crown size={16} />
              {showExpanded && "Claudemar"}
            </NavLink>
          </div>

          <div>
            {showExpanded && (
              <div className="flex items-center justify-between px-3 mb-1.5">
                <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  Agents
                </p>
                <button
                  onClick={() => setCreateAgentOpen(true)}
                  className="text-text-muted hover:text-accent transition-colors"
                  title="Create agent"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {!isMobile && collapsed && (
              <button
                onClick={() => setCreateAgentOpen(true)}
                className="flex items-center justify-center w-full h-8 text-text-muted hover:text-accent transition-colors"
                title="Create agent"
              >
                <Plus size={14} />
              </button>
            )}
            <div className="space-y-0.5">
              {agents.map((a) => (
                <NavLink
                  key={a.name}
                  to={`/agents/${a.name}`}
                  className={linkClass}
                  title={a.name}
                >
                  <StatusDot targetKey={`agent:${a.name}`} statusMap={targetStatus} />
                  <Bot size={14} />
                  {showExpanded && (
                    <>
                      <span className="flex-1 truncate">{a.name}</span>
                      {a.inboxCount > 0 && (
                        <span className="bg-accent/20 text-accent text-xs px-1.5 py-0.5 rounded-full">
                          {a.inboxCount}
                        </span>
                      )}
                    </>
                  )}
                  {!isMobile && collapsed && a.inboxCount > 0 && (
                    <span className="absolute top-0 right-0 w-2 h-2 bg-accent rounded-full" />
                  )}
                </NavLink>
              ))}
              {agents.length === 0 && showExpanded && (
                <p className="px-3 text-xs text-text-muted">No agents</p>
              )}
            </div>
          </div>

          <div>
            {showExpanded && (
              <div className="flex items-center justify-between px-3 mb-1.5">
                <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  Projects
                </p>
                <button
                  onClick={() => setCreateProjectOpen(true)}
                  className="text-text-muted hover:text-accent transition-colors"
                  title="Create project"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {!isMobile && collapsed && (
              <button
                onClick={() => setCreateProjectOpen(true)}
                className="flex items-center justify-center w-full h-8 text-text-muted hover:text-accent transition-colors"
                title="Create project"
              >
                <Plus size={14} />
              </button>
            )}
            <div className="space-y-0.5">
              {projects.map((p) => (
                <NavLink
                  key={p.name}
                  to={`/projects/${p.name}`}
                  className={linkClass}
                  title={p.name}
                >
                  <StatusDot targetKey={`project:${p.name}`} statusMap={targetStatus} />
                  <Folder size={14} />
                  {showExpanded && (
                    <>
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.repoCount > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.hasChanges ? "bg-warning/20 text-warning" : "bg-success/20 text-success"}`}>
                          {p.repoCount}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
              {projects.length === 0 && showExpanded && (
                <p className="px-3 text-xs text-text-muted">No projects</p>
              )}
            </div>
          </div>

          <div>
            {showExpanded && (
              <p className="px-3 mb-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
                Tools
              </p>
            )}
            <NavLink to="/logs" className={linkClass} title="Logs">
              <ScrollText size={16} />
              {showExpanded && "Logs"}
            </NavLink>
            <NavLink to="/changelog" className={linkClass} title="Changelog">
              <GitCommitHorizontal size={16} />
              {showExpanded && "Changelog"}
            </NavLink>
          </div>
        </nav>

        <div className="px-2 py-3 border-t border-border">
          <button
            onClick={logout}
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors w-full ${!isMobile && collapsed ? "justify-center" : ""}`}
            title="Logout"
          >
            <LogOut size={16} />
            {showExpanded && "Logout"}
          </button>
        </div>
        {createAgentOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/60" onClick={() => setCreateAgentOpen(false)} />
            <div className="relative bg-surface border border-border rounded-lg shadow-2xl w-80 mx-4">
              <div className="p-4 border-b border-border">
                <h3 className="text-sm font-medium text-text-primary">Create Agent</h3>
              </div>
              <div className="p-4 space-y-3">
                <input
                  type="text"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateAgent();
                    if (e.key === "Escape") setCreateAgentOpen(false);
                  }}
                  placeholder="Agent name"
                  autoFocus
                  className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setCreateAgentOpen(false)}
                    className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAgent}
                    disabled={!newAgentName.trim() || creatingAgent}
                    className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
                  >
                    {creatingAgent ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {createProjectOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/60" onClick={() => setCreateProjectOpen(false)} />
            <div className="relative bg-surface border border-border rounded-lg shadow-2xl w-80 mx-4">
              <div className="p-4 border-b border-border">
                <h3 className="text-sm font-medium text-text-primary">Create Project</h3>
              </div>
              <div className="p-4 space-y-3">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateProject();
                    if (e.key === "Escape") setCreateProjectOpen(false);
                  }}
                  placeholder="Project name"
                  autoFocus
                  className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setCreateProjectOpen(false)}
                    className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || creatingProject}
                    className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
                  >
                    {creatingProject ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
