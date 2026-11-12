import { Link, useLocation } from "react-router-dom";
import { Bot, Folder, House, Menu } from "lucide-react";
import { isAdmin } from "../../hooks/useAuth";
import { useBrainConnections } from "../../hooks/useBrain";
import { useSidebar } from "./Sidebar";

export function MobileNavigation() {
  const { pathname } = useLocation();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const brainIssues = useBrainConnections();
  const links = [
    { to: isAdmin() ? "/" : "/workspaces", label: "Início", icon: House, active: pathname === "/" || pathname === "/workspaces" },
    { to: "/workspaces/projects", label: "Projetos", icon: Folder, active: pathname.startsWith("/projects/") || pathname === "/workspaces/projects" },
    { to: "/workspaces/agents", label: "Agentes", icon: Bot, active: pathname.startsWith("/agents/") || pathname === "/workspaces/agents" },
  ];
  return (
    <nav aria-label="Navegação principal" className="mobile-navigation">
      {links.map(({ to, label, icon: Icon, active }) => (
        <Link key={to} to={to} aria-current={active ? "page" : undefined} className={active ? "text-accent" : "text-text-secondary"}>
          <Icon size={21} strokeWidth={active ? 2.3 : 1.7} />
          <span>{label}</span>
        </Link>
      ))}
      <button
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-expanded={mobileOpen}
        aria-controls="app-sidebar"
        className="text-text-secondary"
        title={brainIssues.length > 0 ? "Second Brain: conexão precisa de atenção" : undefined}
      >
        <span className="relative inline-flex">
          <Menu size={21} strokeWidth={1.7} />
          {brainIssues.length > 0 && <span className="brain-alert-dot" aria-hidden="true" />}
        </span>
        <span>Menu</span>
      </button>
    </nav>
  );
}
