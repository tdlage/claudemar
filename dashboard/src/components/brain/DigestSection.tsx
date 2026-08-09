import { useEffect, useState } from "react";
import { FileClock, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { MarkdownViewer } from "../shared/MarkdownViewer";
import { useToast } from "../shared/Toast";
import { useBrainData } from "../../hooks/useBrain";

const selectClass =
  "bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent";

export function DigestSection() {
  const { data: dates, loading, refresh } = useBrainData<string[]>("/brain/digest/list");
  const { addToast } = useToast();
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selected && dates && dates.length > 0) setSelected(dates[0]);
  }, [dates, selected]);

  useEffect(() => {
    if (!selected) {
      setContent(null);
      return;
    }
    api
      .get<{ content: string }>(`/brain/digest?date=${selected}`)
      .then((res) => setContent(res.content))
      .catch(() => setContent(null));
  }, [selected]);

  const generateNow = async () => {
    setBusy(true);
    try {
      await api.post("/brain/connectors/digest/run-now", {});
      addToast("success", "Digest gerado");
      const dates = await api.get<string[]>("/brain/digest/list").catch(() => null);
      refresh();
      if (dates && dates.length > 0) setSelected(dates[0]);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileClock size={15} className="text-text-muted" />
        <span className="text-xs text-text-muted flex-1">
          Gerado todo dia às 07:00 com vencidos, prazos próximos, threads críticas e alertas.
        </span>
        {(dates?.length ?? 0) > 0 && (
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className={selectClass}>
            {dates!.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="secondary" onClick={generateNow} disabled={busy}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          <span className="ml-1.5">Gerar agora</span>
        </Button>
      </div>
      {loading && !dates ? (
        <p className="text-sm text-text-muted py-4 text-center">Carregando…</p>
      ) : content ? (
        <Card>
          <MarkdownViewer content={content} />
        </Card>
      ) : (
        <p className="text-sm text-text-muted py-4 text-center">
          Nenhum digest gerado ainda — use "Gerar agora" ou aguarde a execução das 07:00.
        </p>
      )}
    </div>
  );
}
