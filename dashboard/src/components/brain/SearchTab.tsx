import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Search, RefreshCw, DatabaseZap, SlidersHorizontal } from "lucide-react";
import { api } from "../../lib/api";
import { TenantSelect } from "./TenantSelect";
import { Badge } from "../shared/Badge";
import { tenantVariant } from "../../lib/tenantVariant";
import { Button } from "../shared/Button";
import { Card } from "../shared/Card";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import { useBrainData } from "../../hooks/useBrain";
import type {
  BrainIndexStatus,
  BrainRecallDistribution,
  BrainRecallLine,
  BrainSearchResult,
  BrainSettings,
  BrainTenant,
} from "../../lib/types";

const inputClass =
  "bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

const DEGRADED_LABELS: Record<string, string> = {
  "sparse-only": "sem embedding (só BM25)",
  "dense-only": "sem BM25 (só denso)",
  "no-rerank": "sem rerank (ordem RRF)",
  "no-selector": "sem seletor (truncado)",
};

function IndexCard() {
  const { data, loading, refresh } = useBrainData<BrainIndexStatus>("/brain/index/status");
  const { addToast } = useToast();
  const [confirmFull, setConfirmFull] = useState(false);
  const [busy, setBusy] = useState(false);

  const action = async (path: string, body: unknown, okMsg: string) => {
    setBusy(true);
    try {
      await api.post(path, body);
      addToast("success", okMsg);
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmFull(false);
    }
  };

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <DatabaseZap size={15} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary flex-1">Índice T3</h3>
        {loading && <RefreshCw size={13} className="animate-spin text-text-muted" />}
        {data && !data.enabled && <Badge variant="warning">Qdrant não configurado</Badge>}
        {data?.reindexRunning && <Badge variant="accent">reindexando</Badge>}
      </div>
      {data && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>{data.trackedFiles} arquivo(s) rastreado(s)</span>
          <span>
            {data.currentPoints} ponto(s) atuais ({data.points} no total)
          </span>
          <span>
            reconcile:{" "}
            {data.lastFull ? formatDistanceToNow(new Date(data.lastFull), { addSuffix: true }) : "nunca"}
          </span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !data?.enabled}
          onClick={() => action("/brain/connectors/index/run-now", {}, "Indexação incremental executada")}
        >
          Indexar agora
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || !data?.enabled} onClick={() => setConfirmFull(true)}>
          Reindexar tudo
        </Button>
      </div>
      <Modal open={confirmFull} onClose={() => setConfirmFull(false)} title="Reindexar tudo">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Re-embeda todas as páginas do wiki (custo Voyage de centavos; alguns minutos). Continuar?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmFull(false)}>
              Cancelar
            </Button>
            <Button size="sm" disabled={busy} onClick={() => action("/brain/index/reindex", { full: true }, "Reindex completo iniciado")}>
              Reindexar
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function CalibrationCard() {
  const { addToast } = useToast();
  const [month, setMonth] = useState("");
  const distQuery = month
    ? `/brain/telemetry/recall/distribution?month=${month}`
    : "/brain/telemetry/recall/distribution";
  const { data: dist, loading, refresh } = useBrainData<BrainRecallDistribution>(distQuery, [month]);
  const { data: settings, refresh: refreshSettings } = useBrainData<BrainSettings>("/brain/settings");
  const [threshold, setThreshold] = useState("");
  const [saving, setSaving] = useState(false);

  const thresholdLoaded = useRef(false);
  useEffect(() => {
    if (settings && !thresholdLoaded.current) {
      thresholdLoaded.current = true;
      setThreshold(String(settings.retrieval.rerankMinScore));
    }
  }, [settings]);

  const thresholdNum = Number(threshold);
  const thresholdValid = threshold !== "" && Number.isFinite(thresholdNum) && thresholdNum >= 0 && thresholdNum <= 1;
  const maxCount = Math.max(1, ...(dist?.bins.map((b) => b.count) ?? [1]));

  const saveRetrieval = async (patch: Record<string, unknown>, okMsg: string) => {
    setSaving(true);
    try {
      await api.put("/brain/settings", { retrieval: patch });
      addToast("success", okMsg);
      refreshSettings();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal size={15} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary flex-1">Calibração do limiar de confiança</h3>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
        <button
          onClick={refresh}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Atualizar"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!dist || dist.scored === 0 ? (
        <p className="text-xs text-text-muted py-2">
          Sem scores acumulados{(dist?.total ?? 0) > 0 ? " (consultas sem rerank não contam)" : ""} neste mês. O
          limiar deve ser fixado a partir da distribuição de ~2 semanas de consultas reais — até lá, mantenha 0
          (shadow, sem corte).
        </p>
      ) : (
        <>
          <div className="flex items-end gap-1 h-24">
            {dist.bins.map((bin) => (
              <div
                key={bin.from}
                className="flex-1 flex flex-col items-center justify-end gap-1 h-full"
                title={`score ${bin.from.toFixed(1)}–${bin.to.toFixed(1)}: ${bin.count} consulta(s)`}
              >
                <div
                  className={`w-full rounded-sm ${
                    thresholdValid && thresholdNum > 0 && bin.to <= thresholdNum ? "bg-danger/50" : "bg-accent/60"
                  }`}
                  style={{ height: `${Math.max(2, Math.round((bin.count / maxCount) * 80))}px` }}
                />
                <span className="text-[9px] text-text-muted">{bin.from.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              {dist.scored} consulta(s) com score ({dist.total} no total)
            </span>
            {dist.percentiles.p25 !== null && (
              <span className="font-mono">
                p25 {dist.percentiles.p25.toFixed(2)} · p50 {dist.percentiles.p50!.toFixed(2)} · p75{" "}
                {dist.percentiles.p75!.toFixed(2)}
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          limiar (0 = shadow):
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className={`${inputClass} w-20`}
          />
        </label>
        <Button
          size="sm"
          disabled={saving || !thresholdValid || thresholdNum === settings?.retrieval.rerankMinScore}
          onClick={() => saveRetrieval({ rerankMinScore: thresholdNum }, "Limiar atualizado")}
        >
          Fixar limiar
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={settings?.retrieval.businessRanking ?? false}
            disabled={saving || !settings}
            onChange={(e) =>
              saveRetrieval(
                { businessRanking: e.target.checked },
                e.target.checked ? "Ranking de negócio ativado" : "Ranking de negócio desativado",
              )
            }
          />
          ranking de negócio (tipo · recência · utilidade)
        </label>
      </div>
      <p className="text-[11px] text-text-muted">
        Abaixo do limiar o brain responde "não tenho registro confiante sobre isso" em vez de sintetizar evidência
        fraca. Barras em vermelho ficariam cortadas com o limiar atual. O ranking de negócio reordena por tipo,
        recência, saliência e utilidade após o rerank.
      </p>
    </Card>
  );
}

function RecallTelemetryTable() {
  const [month, setMonth] = useState("");
  const query = month ? `/brain/telemetry/recall?month=${month}&limit=100` : "/brain/telemetry/recall?limit=100";
  const { data, loading, refresh } = useBrainData<BrainRecallLine[]>(query, [month]);

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary flex-1">Telemetria de recall (shadow)</h3>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
        <button
          onClick={refresh}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Atualizar"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {(data?.length ?? 0) === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">
          Nenhuma consulta registrada ainda — cada busca (aqui ou pelo Claudemar) grava uma linha usada para calibrar
          o limiar de confiança.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Quando</th>
                <th className="py-1.5 pr-3 font-medium">Origem</th>
                <th className="py-1.5 pr-3 font-medium">Consulta</th>
                <th className="py-1.5 pr-3 font-medium text-right">Cand.</th>
                <th className="py-1.5 pr-3 font-medium text-right">Top score</th>
                <th className="py-1.5 pr-3 font-medium text-right">Min</th>
                <th className="py-1.5 pr-3 font-medium text-right">ms</th>
                <th className="py-1.5 font-medium">Degradação</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((line, i) => (
                <tr key={`${line.ts}-${i}`} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">
                    {format(new Date(line.ts), "dd/MM HH:mm")}
                  </td>
                  <td className="py-1.5 pr-3 text-text-muted">{line.tool}</td>
                  <td className="py-1.5 pr-3 text-text-secondary max-w-64 truncate" title={line.query}>
                    {line.query}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-text-secondary">{line.candidates_rrf}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-text-primary">
                    {line.top_rerank_score?.toFixed(2) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-text-muted">
                    {line.min_rerank_score?.toFixed(2) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-text-muted">{line.duration_ms}</td>
                  <td className="py-1.5">
                    {line.degraded ? <Badge variant="warning">{line.degraded}</Badge> : <span className="text-text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function SearchTab() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [query, setQuery] = useState("");
  const [tenant, setTenant] = useState("");
  const [type, setType] = useState("");
  const [includePii, setIncludePii] = useState(false);
  const [result, setResult] = useState<BrainSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.post<BrainSearchResult>("/brain/search", {
        query: query.trim(),
        tenant: (tenant || undefined) as BrainTenant | undefined,
        type: type || undefined,
        includePii,
      });
      setResult(res);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Buscar no conhecimento compilado… (ex.: status do visto)"
            className={`${inputClass} w-full pl-8`}
          />
        </div>
        <TenantSelect value={tenant} onChange={setTenant} allowAll className={inputClass} />
        <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
          <option value="">tipo: todos</option>
          <option value="person">pessoa</option>
          <option value="org">organização</option>
          <option value="project">projeto</option>
          <option value="topic">tema</option>
          <option value="thread">thread</option>
          <option value="lesson">lição</option>
          <option value="decision">decisão</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
          <input type="checkbox" checked={includePii} onChange={(e) => setIncludePii(e.target.checked)} />
          incluir PII
        </label>
        <Button size="sm" onClick={search} disabled={searching || !query.trim()}>
          {searching ? "Buscando…" : "Buscar"}
        </Button>
      </div>

      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
            <span>{result.hits.length} resultado(s)</span>
            <span>{result.candidatesRrf} candidato(s) RRF</span>
            <span>{result.durationMs} ms</span>
            {result.topRerankScore !== null && (
              <span className="font-mono">
                score {result.minRerankScore?.toFixed(2)}–{result.topRerankScore.toFixed(2)}
              </span>
            )}
            {result.ranked && <Badge variant="accent">ranking de negócio</Badge>}
            {result.belowThreshold > 0 && (
              <Badge variant="warning">{result.belowThreshold} abaixo do limiar</Badge>
            )}
            {result.degraded.map((d) => (
              <Badge key={d} variant="warning">
                {DEGRADED_LABELS[d] ?? d}
              </Badge>
            ))}
          </div>
          {result.hits.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">
              {result.belowThreshold > 0
                ? "Não há registro confiante para esta consulta — os candidatos ficaram abaixo do limiar calibrado."
                : "Nenhum registro no brain para esta consulta."}
            </p>
          ) : (
            result.hits.map((hit, i) => (
              <Card key={`${hit.sourceKey}-${i}`} className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() =>
                      navigate(`/second-brain/wiki/${hit.sourceKey.replace(/^wiki\//, "").replace(/\.md$/, "")}`)
                    }
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {hit.title}
                  </button>
                  <Badge variant="accent">{hit.type}</Badge>
                  <Badge variant={tenantVariant(hit.tenant)}>{hit.tenant}</Badge>
                  {hit.containsPii && <Badge variant="warning">PII</Badge>}
                  <span className="text-xs text-text-muted ml-auto">
                    {hit.rerankScore !== null && <span className="font-mono mr-2">{hit.rerankScore.toFixed(2)}</span>}
                    {hit.updatedAt}
                  </span>
                </div>
                <p className="text-xs text-text-secondary whitespace-pre-wrap line-clamp-6">{hit.text}</p>
                <p className="text-[10px] text-text-muted font-mono">{hit.sourceKey}</p>
              </Card>
            ))
          )}
        </div>
      )}

      <CalibrationCard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <IndexCard />
        <RecallTelemetryTable />
      </div>
    </div>
  );
}
