import { Link, useLocation } from "react-router-dom";
import { Bot, Folder, House, KanbanSquare, Menu } from "lucide-react";
import { isAdmin } from "../../hooks/useAuth";
import { useSidebar } from "./Sidebar";

export function MobileNavigation() {
  const { pathname } = useLocation();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const links = [
    { to: isAdmin() ? "/" : "/workspaces", label: "Início", icon: House, active: pathname === "/" || pathname === "/workspaces" },
    { to: "/workspaces/projects", label: "Projetos", icon: Folder, active: pathname.startsWith("/projects/") || pathname === "/workspaces/projects" },
    { to: "/workspaces/agents", label: "Agentes", icon: Bot, active: pathname.startsWith("/agents/") || pathname === "/workspaces/agents" },
    { to: "/tracker", label: "Tarefas", icon: KanbanSquare, active: pathname.startsWith("/tracker") },
  ];
  return (
    <nav aria-label="Navegação principal" className="mobile-navigation">
      {links.map(({ to, label, icon: Icon, active }) => (
        <Link key={to} to={to} aria-current={active ? "page" : undefined} className={active ? "text-accent" : "text-text-secondary"}>
          <Icon size={21} strokeWidth={active ? 2.3 : 1.7} />
          <span>{label}</span>
        </Link>
      ))}
      <button type="button" onClick={() => setMobileOpen(!mobileOpen)} aria-expanded={mobileOpen} aria-controls="app-sidebar" className="text-text-secondary">
        <Menu size={21} strokeWidth={1.7} /><span>Menu</span>
      </button>
    </nav>
  );
}
