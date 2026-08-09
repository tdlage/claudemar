import { RefreshCw } from "lucide-react";
import { Card } from "../shared/Card";
import { MarkdownViewer } from "../shared/MarkdownViewer";
import { useBrainData } from "../../hooks/useBrain";

export function LogTab() {
  const { data, loading, refresh } = useBrainData<{ content: string }>("/brain/log?lines=500");

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={refresh}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Atualizar"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {loading && !data ? (
        <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>
      ) : data?.content ? (
        <Card>
          <MarkdownViewer content={data.content} />
        </Card>
      ) : (
        <p className="text-sm text-text-muted py-8 text-center">
          Sem entradas no log ainda — cada compilação registra uma linha em wiki/log.md.
        </p>
      )}
    </div>
  );
}
