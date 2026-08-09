import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { MarkdownViewer } from "../shared/MarkdownViewer";
import { Badge } from "../shared/Badge";
import { RawThreadHeader } from "./RawThreadHeader";
import { useBrainData } from "../../hooks/useBrain";
import type { RawThread } from "../../lib/types";

export function RawThreadView({ path, channel }: { path: string; channel: string }) {
  const navigate = useNavigate();
  const [showChatter, setShowChatter] = useState(true);
  const { data, loading, error } = useBrainData<RawThread>(
    `/brain/raw/thread?path=${encodeURIComponent(path)}`,
  );

  if (loading) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;
  if (error || !data) {
    return (
      <div className="py-8 text-center space-y-2">
        <p className="text-sm text-danger">{error ?? "Thread não encontrada"}</p>
        <button onClick={() => navigate(`/second-brain/raw/${channel}`)} className="text-sm text-accent hover:underline">
          Voltar para a lista
        </button>
      </div>
    );
  }

  const blocks = showChatter ? data.blocks : data.blocks.filter((b) => b.chatter === null);
  const chatterCount = data.blocks.filter((b) => b.chatter !== null).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(`/second-brain/raw/${channel}`)}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Voltar"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-xs text-text-muted font-mono truncate flex-1">{data.path}</span>
        {chatterCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showChatter}
              onChange={(e) => setShowChatter(e.target.checked)}
              className="accent-[var(--color-accent,#6366f1)]"
            />
            Mostrar chatter ({chatterCount})
          </label>
        )}
      </div>
      <RawThreadHeader fm={data.frontmatter} />
      <div className="space-y-2.5">
        {blocks.map((block) => (
          <div
            key={block.externalId}
            className={`bg-surface border border-border rounded-lg p-3 ${block.chatter ? "opacity-50" : ""}`}
          >
            <div className="flex items-center gap-2 mb-1.5 text-xs">
              <span className="font-medium text-text-secondary truncate">{block.sender}</span>
              <span className="text-text-muted font-mono shrink-0">
                {(() => {
                  try {
                    return format(new Date(block.at), "dd/MM/yyyy HH:mm");
                  } catch {
                    return block.at;
                  }
                })()}
              </span>
              <span className="text-text-muted">{block.lang}</span>
              {block.chatter && <Badge>chatter · {block.chatter}</Badge>}
            </div>
            <MarkdownViewer content={block.body} />
          </div>
        ))}
        {blocks.length === 0 && (
          <p className="text-sm text-text-muted py-4 text-center">Todas as mensagens desta thread são chatter.</p>
        )}
      </div>
    </div>
  );
}
