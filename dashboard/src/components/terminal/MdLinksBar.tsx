import { useState } from "react";
import { FileText } from "lucide-react";
import { MarkdownViewerModal } from "../shared/MarkdownViewerModal";

interface MdLinksBarProps {
  paths: string[];
  base: string;
}

export function MdLinksBar({ paths, base }: MdLinksBarProps) {
  const [viewerPath, setViewerPath] = useState<string | null>(null);

  if (paths.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 px-2 py-1 bg-surface border-t border-border overflow-x-auto scrollbar-thin">
        <FileText size={11} className="text-text-muted shrink-0" />
        {paths.map((p) => (
          <button
            key={p}
            onClick={() => setViewerPath(p)}
            className="text-[11px] font-mono text-accent hover:text-accent-hover bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5 whitespace-nowrap transition-colors cursor-pointer"
          >
            {p}
          </button>
        ))}
      </div>
      {viewerPath && (
        <MarkdownViewerModal
          open
          onClose={() => setViewerPath(null)}
          filePath={viewerPath}
          base={base}
        />
      )}
    </>
  );
}
