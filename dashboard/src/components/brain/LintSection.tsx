import { useEffect, useState } from "react";
import { Stethoscope, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { MarkdownViewer } from "../shared/MarkdownViewer";
import { useToast } from "../shared/Toast";
import { useBrainData } from "../../hooks/useBrain";

const selectClass =
  "bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent";

export function LintSection() {
  const { data: weeks, loading, refresh } = useBrainData<string[]>("/brain/lint/list");
  const { addToast } = useToast();
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selected && weeks && weeks.length > 0) setSelected(weeks[0]);
  }, [weeks, selected]);

  useEffect(() => {
    if (!selected) {
      setContent(null);
      return;
    }
    api
      .get<{ content: string }>(`/brain/lint?week=${selected}`)
      .then((res) => setContent(res.content))
      .catch(() => setContent(null));
  }, [selected]);

  const runNow = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ week: string; findings: number }>("/brain/lint/run", {});
      addToast("success", `Lint ${result.week}: ${result.findings} achado(s)`);
      refresh();
      setSelected(result.week);
      const res = await api.get<{ content: string }>(`/brain/lint?week=${result.week}`).catch(() => null);
      if (res) setContent(res.content);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Stethoscope size={15} className="text-text-muted" />
        <span className="text-xs text-text-muted flex-1">
          Relatório semanal de saúde do wiki (domingo 05:00): fontes quebradas, revisões vencidas, órfãs,
          quase-duplicatas e contradições. Só propõe — nada é alterado automaticamente.
        </span>
        {(weeks?.length ?? 0) > 0 && (
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className={selectClass}>
            {weeks!.map((week) => (
              <option key={week} value={week}>
                {week}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="secondary" onClick={runNow} disabled={busy}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          <span className="ml-1.5">Rodar agora</span>
        </Button>
      </div>
      {loading && !weeks ? (
        <p className="text-sm text-text-muted py-4 text-center">Carregando…</p>
      ) : content ? (
        <Card>
          <MarkdownViewer content={content} />
        </Card>
      ) : (
        <p className="text-sm text-text-muted py-4 text-center">
          Nenhum relatório ainda — use "Rodar agora" ou ligue o scheduler de lint.
        </p>
      )}
    </div>
  );
}
