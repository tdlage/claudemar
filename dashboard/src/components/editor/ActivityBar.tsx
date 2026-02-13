import { Files, Search, Play } from "lucide-react";

export type ActivityView = "files" | "search" | "run";

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
}

const items: Array<{ view: ActivityView; icon: typeof Files; label: string }> = [
  { view: "files", icon: Files, label: "Explorer" },
  { view: "search", icon: Search, label: "Search" },
  { view: "run", icon: Play, label: "Run and Debug" },
];

export function ActivityBar({ activeView, onViewChange }: ActivityBarProps) {
  return (
    <div className="w-12 bg-bg border-r border-border flex flex-col shrink-0">
      {items.map(({ view, icon: Icon, label }) => (
        <button
          key={view}
          onClick={() => onViewChange(activeView === view ? view : view)}
          className={`flex items-center justify-center h-12 transition-colors relative ${
            activeView === view
              ? "text-text-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
          title={label}
        >
          {activeView === view && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r" />
          )}
          <Icon size={20} />
        </button>
      ))}
    </div>
  );
}
