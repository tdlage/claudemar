import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WikiTreeSection } from "../../lib/types";

const DIR_LABELS: Record<string, string> = {
  people: "Pessoas",
  orgs: "Organizações",
  projects: "Projetos",
  topics: "Temas",
  threads: "Threads",
  lessons: "Lições",
};

export function WikiTree({
  sections,
  activePath,
  onSelect,
}: {
  sections: WikiTreeSection[];
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-1">
      {sections.map((section) => {
        const isCollapsed = collapsed[section.dir] ?? section.pages.length === 0;
        return (
          <div key={section.dir}>
            <button
              onClick={() => setCollapsed((prev) => ({ ...prev, [section.dir]: !isCollapsed }))}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-muted uppercase tracking-wider hover:text-text-primary transition-colors"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {DIR_LABELS[section.dir] ?? section.dir}
              <span className="ml-auto">{section.pages.length}</span>
            </button>
            {!isCollapsed &&
              section.pages.map((page) => (
                <button
                  key={page.path}
                  onClick={() => onSelect(page.path)}
                  className={`w-full text-left px-3 py-1 rounded text-sm truncate transition-colors ${
                    activePath === page.path
                      ? "bg-accent/15 text-accent"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                  }`}
                  title={page.title}
                >
                  {page.title}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
