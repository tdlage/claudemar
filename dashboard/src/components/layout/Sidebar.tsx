import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Cpu,
  Bot,
  FolderGit2,
  FileCode,
  ScrollText,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { useSocketEvent } from "../../hooks/useSocket";
import type { AgentInfo, ProjectInfo, ExecutionInfo } from "../../lib/types";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1200;
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1199px)");
    const handler = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
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
  const { collapsed, setCollapsed } = useSidebar();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [targetStatus, setTargetStatus] = useState<TargetStatus>({});

  useEffect(() => {
    api.get<AgentInfo[]>("/agents").then(setAgents).catch(() => {});
    api.get<ProjectInfo[]>("/projects").then(setProjects).catch(() => {});
    api.get<TargetStatus>("/executions/target-status").then(setTargetStatus).catch(() => {});
  }, []);

  const markRunning = useCallback((info: ExecutionInfo) => {
    const key = `${info.targetType}:${info.targetName}`;
    setTargetStatus((prev) => ({
      ...prev,
      [key]: { running: true, lastStatus: prev[key]?.lastStatus ?? null },
    }));
  }, []);

  const markDone = useCallback((info: ExecutionInfo) => {
    const key = `${info.targetType}:${info.targetName}`;
    setTargetStatus((prev) => ({
      ...prev,
      [key]: { running: false, lastStatus: info.status as "completed" | "error" | "cancelled" },
    }));
  }, []);

  useSocketEvent<{ info: ExecutionInfo }>("execution:start", ({ info }) => markRunning(info));
  useSocketEvent<{ info: ExecutionInfo }>("execution:complete", ({ info }) => markDone(info));
  useSocketEvent<{ info: ExecutionInfo }>("execution:error", ({ info }) => markDone(info));
  useSocketEvent<{ info: ExecutionInfo }>("execution:cancel", ({ info }) => markDone(info));

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
      collapsed ? "justify-center" : ""
    } ${
      isActive
        ? "bg-accent/15 text-accent"
        : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
    }`;

  return (
    <aside
      className={`h-screen bg-surface border-r border-border flex flex-col fixed left-0 top-0 z-20 transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className="px-3 py-4 border-b border-border flex items-center justify-between min-h-[57px]">
        {!collapsed && (
          <div>
            <h1 className="text-sm font-semibold text-text-primary tracking-tight">
              Claudemar
            </h1>
            <p className="text-xs text-text-muted mt-0.5">Dashboard</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        <div className="space-y-0.5">
          <NavLink to="/" end className={linkClass} title="Overview">
            <LayoutDashboard size={16} />
            {!collapsed && "Overview"}
          </NavLink>
          <NavLink to="/orchestrator" className={linkClass} title="Orchestrator">
            <Cpu size={16} />
            {!collapsed && "Orchestrator"}
          </NavLink>
        </div>

        <div>
          {!collapsed && (
            <p className="px-3 mb-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
              Agents
            </p>
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
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{a.name}</span>
                    {a.inboxCount > 0 && (
                      <span className="bg-accent/20 text-accent text-xs px-1.5 py-0.5 rounded-full">
                        {a.inboxCount}
                      </span>
                    )}
                  </>
                )}
                {collapsed && a.inboxCount > 0 && (
                  <span className="absolute top-0 right-0 w-2 h-2 bg-accent rounded-full" />
                )}
              </NavLink>
            ))}
            {agents.length === 0 && !collapsed && (
              <p className="px-3 text-xs text-text-muted">No agents</p>
            )}
          </div>
        </div>

        <div>
          {!collapsed && (
            <p className="px-3 mb-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
              Projects
            </p>
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
                <FolderGit2 size={14} />
                {!collapsed && <span className="truncate">{p.name}</span>}
              </NavLink>
            ))}
            {projects.length === 0 && !collapsed && (
              <p className="px-3 text-xs text-text-muted">No projects</p>
            )}
          </div>
        </div>

        <div>
          {!collapsed && (
            <p className="px-3 mb-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
              Tools
            </p>
          )}
          <NavLink to="/editor" className={linkClass} title="Editor">
            <FileCode size={16} />
            {!collapsed && "Editor"}
          </NavLink>
          <NavLink to="/logs" className={linkClass} title="Logs">
            <ScrollText size={16} />
            {!collapsed && "Logs"}
          </NavLink>
        </div>
      </nav>

      <div className="px-2 py-3 border-t border-border">
        <button
          onClick={logout}
          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors w-full ${collapsed ? "justify-center" : ""}`}
          title="Logout"
        >
          <LogOut size={16} />
          {!collapsed && "Logout"}
        </button>
      </div>
    </aside>
  );
}
