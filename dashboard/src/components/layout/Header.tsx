import { useLocation } from "react-router-dom";
import { Search } from "lucide-react";

export function Header() {
  const location = useLocation();

  const breadcrumbs = buildBreadcrumbs(location.pathname);

  return (
    <header className="h-12 border-b border-border bg-surface/50 backdrop-blur-sm flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-text-muted">/</span>}
            <span
              className={
                i === breadcrumbs.length - 1
                  ? "text-text-primary"
                  : "text-text-muted"
              }
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

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
    </header>
  );
}

function buildBreadcrumbs(pathname: string): string[] {
  if (pathname === "/") return ["Overview"];
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}
