import { format } from "date-fns";
import { Card } from "../shared/Card";
import { useBrainData } from "../../hooks/useBrain";
import type { WikiVersion } from "../../lib/types";

export function WikiHistoryPanel({
  path,
  activeRef,
  onSelect,
  onCurrent,
}: {
  path: string;
  activeRef: string | null;
  onSelect: (sha: string) => void;
  onCurrent: () => void;
}) {
  const { data, loading } = useBrainData<WikiVersion[]>(
    `/brain/wiki/history?path=${encodeURIComponent(path)}`,
  );

  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold text-text-primary">Histórico</h3>
      {loading && <p className="text-xs text-text-muted">Carregando…</p>}
      {!loading && (data?.length ?? 0) === 0 && (
        <p className="text-xs text-text-muted">Nenhuma versão commitada ainda.</p>
      )}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {data?.map((version, i) => {
          const isActive = activeRef ? version.sha.startsWith(activeRef) || activeRef.startsWith(version.sha) : i === 0;
          return (
            <button
              key={version.sha}
              onClick={() => (i === 0 ? onCurrent() : onSelect(version.sha))}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                isActive ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-surface-hover"
              }`}
            >
              <span className="font-mono">{version.sha.slice(0, 8)}</span>
              <span className="text-text-muted ml-2">
                {(() => {
                  try {
                    return format(new Date(version.date), "dd/MM/yyyy HH:mm");
                  } catch {
                    return version.date;
                  }
                })()}
              </span>
              {i === 0 && <span className="ml-2 text-success">atual</span>}
              <p className="text-text-muted truncate">{version.message}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
