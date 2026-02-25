import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu, RefreshCw, Search } from "lucide-react";
import { api } from "../../lib/api";
import { SystemResources } from "./SystemResources";
import { ProcessIndicator } from "./ProcessIndicator";
import { useSidebar } from "./Sidebar";
import { isAdmin } from "../../hooks/useAuth";

export function Header() {
  const location = useLocation();
  const { isMobile, setMobileOpen } = useSidebar();
  const admin = isAdmin();
  const [reloading, setReloading] = useState(false);

  const breadcrumbs = buildBreadcrumbs(location.pathname);

  return (
    <header className="h-12 border-b border-border bg-surface/50 backdrop-blur-sm flex items-center justify-between px-3 md:px-6 sticky top-0 z-10">
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && (
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors shrink-0"
            title="Open menu"
          >
            <Menu size={18} />
          </button>
        )}
        <nav className="flex items-center gap-1.5 text-sm min-w-0 truncate">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-text-muted">/</span>}
              <span
                className={
                  i === breadcrumbs.length - 1
                    ? "text-text-primary truncate"
                    : "text-text-muted"
                }
              >
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        {admin && <span className="hidden sm:block"><SystemResources /></span>}
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
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
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

const BREADCRUMB_LABELS: Record<string, string> = {};

function buildBreadcrumbs(pathname: string): string[] {
  if (pathname === "/") return ["Overview"];
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((p) => BREADCRUMB_LABELS[p] || p.charAt(0).toUpperCase() + p.slice(1));
}
