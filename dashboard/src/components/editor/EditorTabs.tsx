import { useRef, useEffect, type MouseEvent } from "react";
import { X } from "lucide-react";

export interface OpenFile {
  path: string;
  dirty: boolean;
}

interface EditorTabsProps {
  tabs: OpenFile[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

export function EditorTabs({
  tabs,
  activeTab,
  onSelect,
  onClose,
}: EditorTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeTab || !containerRef.current) return;
    const activeEl = containerRef.current.querySelector(
      `[data-tab="${CSS.escape(activeTab)}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  if (tabs.length === 0) return null;

  const handleMiddleClick = (e: MouseEvent, path: string) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(path);
    }
  };

  const handleCloseClick = (e: MouseEvent, path: string) => {
    e.stopPropagation();
    onClose(path);
  };

  return (
    <div
      ref={containerRef}
      className="flex items-stretch border-b border-border bg-surface overflow-x-auto scrollbar-thin"
    >
      {tabs.map((tab) => (
        <button
          key={tab.path}
          data-tab={tab.path}
          onClick={() => onSelect(tab.path)}
          onMouseDown={(e) => handleMiddleClick(e, tab.path)}
          className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border shrink-0 ${
            activeTab === tab.path
              ? "bg-bg text-text-primary"
              : "text-text-muted hover:bg-surface-hover"
          }`}
        >
          {tab.dirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          )}
          <span className="truncate max-w-[120px]">{basename(tab.path)}</span>
          <span
            onClick={(e) => handleCloseClick(e, tab.path)}
            className="ml-1 p-0.5 rounded hover:bg-border opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </span>
        </button>
      ))}
    </div>
  );
}
