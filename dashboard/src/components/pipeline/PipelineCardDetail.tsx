import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import type { PipelineCard, PipelineStage, PipelineStageRun } from "../../lib/types";
import { PROJECT_SELECTABLE_MODELS } from "../../lib/types";
import { api } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { MarkdownViewer } from "../shared/MarkdownViewer";
import { useCardRuns } from "../../hooks/usePipeline";
import { UsageIndicator } from "./UsageIndicator";
import { CARD_STATUS_CONFIG, PIPELINE_STAGES, RUN_STATUS_CONFIG, SKIPPABLE_STAGES, STAGE_LABEL } from "./constants";

const STAGE_INDEX: Record<PipelineStage, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s, i) => [s.key, i]),
) as Record<PipelineStage, number>;

function LiveOutput({ execId }: { execId: string }) {
  const [output, setOutput] = useState("");
  useEffect(() => {
    const socket = getSocket();
    setOutput("");
    const onCatchup = (d: { id: string; output: string }) => { if (d.id === execId) setOutput(d.output || ""); };
    const onOutput = (d: { id: string; chunk: string }) => { if (d.id === execId) setOutput((p) => p + d.chunk); };
    socket.on("execution:catchup", onCatchup);
    socket.on("execution:output", onOutput);
    socket.emit("subscribe:execution", execId);
    return () => {
      socket.emit("unsubscribe:execution", execId);
      socket.off("execution:catchup", onCatchup);
      socket.off("execution:output", onOutput);
    };
  }, [execId]);
  return <pre className="text-[11px] whitespace-pre-wrap text-text-muted bg-bg rounded p-2 border border-border max-h-96 overflow-auto">{output || "Aguardando saída do agente..."}</pre>;
}

interface Props {
  card: PipelineCard;
  projectName: string;
  availableRepos: string[];
  onClose: () => void;
}

export function RunArtifacts({ run }: { run: PipelineStageRun }) {
  const a = run.artifacts;
  return (
    <div className="space-y-2">
      {a.requirement && (
        <div className="bg-bg rounded p-2 border border-border max-h-96 overflow-auto">
          <MarkdownViewer content={a.requirement} />
        </div>
      )}
      {a.plan && (
        <div className="space-y-2">
          <div className="rounded p-2 border border-accent/30 bg-accent/5">
            <p className="text-[11px] font-semibold text-text-secondary mb-1.5">Repositórios afetados (identificados no plano)</p>
            {a.plan.repos.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {a.plan.repos.map((repo) => (
                  <Badge key={repo} variant="accent">{repo}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">Nenhum repositório identificado</p>
            )}
          </div>
          <div className="bg-bg rounded p-2 border border-border max-h-96 overflow-auto">
            <MarkdownViewer content={a.plan.markdown} />
          </div>
        </div>
      )}
      {a.tests && (
        <div className="text-xs">
          <span className={a.tests.passed ? "text-success" : "text-danger"}>
            Testes: {a.tests.total - a.tests.failed}/{a.tests.total} passaram
          </span>
          {a.tests.logs && <pre className="mt-1 whitespace-pre-wrap text-text-muted bg-bg rounded p-2 border border-border max-h-48 overflow-auto">{a.tests.logs}</pre>}
        </div>
      )}
      {a.review && (
        <div className="text-xs">
          <span className={a.review.clean && a.review.testsPass ? "text-success" : "text-warning"}>
            Code review: {a.review.fixed}/{a.review.totalFindings} corrigidos · clean={String(a.review.clean)} · testes={String(a.review.testsPass)}
          </span>
          {a.review.summary && (
            <div className="mt-1 bg-bg rounded p-2 border border-border max-h-96 overflow-auto">
              <MarkdownViewer content={a.review.summary} />
            </div>
          )}
        </div>
      )}
      {a.e2e && (
        <div className="text-xs space-y-1">
          <span className={a.e2e.passed ? "text-success" : "text-danger"}>E2E: {a.e2e.passed ? "passou" : "falhou"}</span>
          {a.e2e.screenshots.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {a.e2e.screenshots.map((src) => (
                <a key={src} href={src} target="_blank" rel="noreferrer">
                  <img src={src} alt="evidência" className="rounded border border-border w-full h-24 object-cover hover:opacity-80" />
                </a>
              ))}
            </div>
          )}
          {a.e2e.logs && <pre className="whitespace-pre-wrap text-text-muted bg-bg rounded p-2 border border-border max-h-48 overflow-auto">{a.e2e.logs}</pre>}
        </div>
      )}
      {a.prs && a.prs.length > 0 && (
        <div className="space-y-1">
          {a.prs.map((pr) => (
            <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-accent hover:underline">
              <GitPullRequest size={12} />{pr.repo} #{pr.number}<ExternalLink size={11} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function PipelineCardDetail({ card, projectName, availableRepos, onClose }: Props) {
  const { runs } = useCardRuns(card.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSendBack, setShowSendBack] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [editRepos, setEditRepos] = useState(false);
  const [repoSel, setRepoSel] = useState<string[]>([]);
  const [modelSelectable, setModelSelectable] = useState(false);
  const canEditRepos = (card.stage === "requirement" || card.stage === "plan") && card.status !== "running";

  useEffect(() => {
    api.get<{ provider: string }>("/system/provider").then((d) => setModelSelectable(d.provider === "anthropic")).catch(() => {});
  }, []);

  const status = CARD_STATUS_CONFIG[card.status];
  const showStart = card.status === "idle";
  const gated = card.status === "awaiting_gate" || card.status === "failed";
  const activeRun = runs.find((r) => r.status === "running" && r.execId);

  const monitorHasOpenPr = card.stage === "monitor" && card.repos.some((r) => r.prUrl && r.repoStatus !== "merged" && r.repoStatus !== "closed");
  const concludeLabel = card.stage !== "monitor" ? "Aprovar etapa" : monitorHasOpenPr ? "Mergear PR e concluir" : "Concluir";
  const ConcludeIcon = monitorHasOpenPr ? GitMerge : CheckCircle2;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na ação");
    } finally {
      setBusy(false);
    }
  };

  const toggleSkip = (stage: PipelineStage) => {
    const next = new Set(card.skippedStages);
    if (next.has(stage)) next.delete(stage);
    else next.add(stage);
    const skippedStages = SKIPPABLE_STAGES.filter((s) => next.has(s));
    return api.patch(`/pipeline/cards/${card.id}/skip`, { skippedStages });
  };

  return (
    <Modal open onClose={onClose} title={`${projectName}#${card.seqNumber} · ${card.title}`} size="xl">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-xs text-text-muted">Etapa: {STAGE_LABEL[card.stage]}</span>
          {modelSelectable && (
            <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-secondary">
              Modelo
              <select
                value={card.model ?? ""}
                disabled={busy || card.status === "running"}
                onChange={(e) => act(() => api.patch(`/pipeline/cards/${card.id}/model`, { model: e.target.value || null }))}
                className="bg-bg border border-border rounded px-1.5 py-1 focus:outline-none focus:border-accent"
              >
                <option value="">Modelo do projeto</option>
                {PROJECT_SELECTABLE_MODELS.map((m) => <option key={m.model} value={m.model}>{m.displayName}</option>)}
              </select>
            </label>
          )}
          <label className={`${modelSelectable ? "" : "ml-auto "}inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer`}>
            <input
              type="checkbox"
              checked={card.auto}
              disabled={busy}
              onChange={(e) => act(() => api.patch(`/pipeline/cards/${card.id}/auto`, { auto: e.target.checked }))}
            />
            Automático
          </label>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        {showStart && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => api.post(`/pipeline/cards/${card.id}/retry`))}>
              <CheckCircle2 size={14} className="mr-1" /> Iniciar etapa “{STAGE_LABEL[card.stage]}”
            </Button>
          </div>
        )}

        {gated && (
          <div className="flex items-center gap-2 flex-wrap">
            {card.status === "awaiting_gate" && (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => api.post(`/pipeline/cards/${card.id}/advance`))}>
                <ConcludeIcon size={14} className="mr-1" /> {concludeLabel}
              </Button>
            )}
            {card.stage !== "monitor" && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => api.post(`/pipeline/cards/${card.id}/retry`))}>
                Repetir
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowSendBack((v) => !v)}>
              Devolver p/ implementação
            </Button>
            {card.status !== "failed" && (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(() => api.post(`/pipeline/cards/${card.id}/reject`))}>
                Rejeitar
              </Button>
            )}
          </div>
        )}

        {showSendBack && (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="O que precisa ser ajustado na implementação?"
              className="w-full h-20 bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent"
            />
            <Button size="sm" variant="primary" disabled={busy || !feedback.trim()} onClick={() => act(async () => {
              await api.post(`/pipeline/cards/${card.id}/send-back`, { feedback });
              setShowSendBack(false);
              setFeedback("");
            })}>
              Enviar e reabrir implementação
            </Button>
          </div>
        )}

        {activeRun?.execId && (
          <section>
            <h4 className="text-xs font-semibold text-text-secondary mb-1 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin text-blue-400" /> Execução ao vivo · {STAGE_LABEL[activeRun.stage]}
            </h4>
            <LiveOutput execId={activeRun.execId} />
          </section>
        )}

        {card.intakeInput && (
          <section>
            <h4 className="text-xs font-semibold text-text-secondary mb-1">Entrada de captação</h4>
            <pre className="text-xs whitespace-pre-wrap text-text-secondary bg-bg rounded p-2 border border-border">{card.intakeInput}</pre>
          </section>
        )}

        <section>
          <h4 className="text-xs font-semibold text-text-secondary mb-1.5">Etapas a executar</h4>
          <div className="flex flex-wrap gap-1.5">
            {PIPELINE_STAGES.filter((s) => s.key !== "monitor").map((s) => {
              const isImpl = s.key === "implementation";
              const willRun = isImpl || !card.skippedStages.includes(s.key);
              const passed = STAGE_INDEX[s.key] < STAGE_INDEX[card.stage];
              const disabled = busy || isImpl || passed || card.status === "running";
              return (
                <label
                  key={s.key}
                  title={isImpl ? "A implementação é obrigatória" : passed ? "Etapa já ultrapassada" : undefined}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                    willRun ? "bg-accent/15 border-accent/40 text-accent" : "bg-bg border-border text-text-muted line-through"
                  } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={willRun}
                    disabled={disabled}
                    onChange={() => act(() => toggleSkip(s.key))}
                  />
                  {s.label}
                  {isImpl && <span className="text-[10px] text-text-muted">obrigatória</span>}
                </label>
              );
            })}
          </div>
          <p className="text-[10px] text-text-muted mt-1">Desmarque etapas para pulá-las em itens simples. A implementação não pode ser pulada.</p>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-semibold text-text-secondary">Repositórios-alvo selecionados</h4>
            {canEditRepos && !editRepos && (
              <button className="text-[11px] text-accent hover:underline" onClick={() => { setRepoSel(card.repos.map((r) => r.repoName)); setEditRepos(true); }}>editar</button>
            )}
          </div>
          {editRepos ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {availableRepos.map((r) => (
                  <button key={r} onClick={() => setRepoSel((p) => p.includes(r) ? p.filter((x) => x !== r) : [...p, r])}
                    className={`px-2 py-1 rounded text-xs border ${repoSel.includes(r) ? "bg-accent/15 border-accent/40 text-accent" : "bg-bg border-border text-text-muted"}`}>{r}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={busy || repoSel.length === 0} onClick={() => act(async () => { await api.put(`/pipeline/cards/${card.id}/repos`, { repos: repoSel }); setEditRepos(false); })}>Salvar repos</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditRepos(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
          <div className="space-y-1">
            {card.repos.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs text-text-muted">
                <span className="font-mono text-text-secondary">{r.repoName}</span>
                {r.branch && <span>· {r.branch}</span>}
                <Badge variant={r.repoStatus === "merged" ? "success" : r.repoStatus === "pr_open" ? "accent" : "default"}>{r.repoStatus}</Badge>
                {r.prUrl && <a href={r.prUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">PR #{r.prNumber}<ExternalLink size={10} /></a>}
              </div>
            ))}
          </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-semibold text-text-secondary">Etapas</h4>
            <UsageIndicator costUsd={card.totalCostUsd} totalTokens={card.totalTokens} contextPct={card.contextPct} className="ml-auto text-[11px] text-text-muted" />
          </div>
          {runs.length === 0 && <p className="text-xs text-text-muted">Nenhuma execução ainda.</p>}
          <div className="space-y-2">
            {runs.map((run) => {
              const rs = RUN_STATUS_CONFIG[run.status];
              return (
                <div key={run.id} className="border border-border rounded-md p-2.5 bg-surface">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium">{STAGE_LABEL[run.stage]}</span>
                    {run.attempt > 1 && <span className="text-[10px] text-text-muted">tentativa {run.attempt}</span>}
                    <UsageIndicator costUsd={run.costUsd} totalTokens={run.totalTokens} contextPct={run.contextPct} className="ml-auto text-[10px] text-text-muted" />
                    <span className="inline-flex items-center gap-1">
                      {run.status === "running"
                        ? <Loader2 size={12} className="animate-spin text-blue-400" />
                        : run.status === "passed" ? <CheckCircle2 size={12} className="text-success" /> : <XCircle size={12} className="text-danger" />}
                      <Badge variant={rs.variant}>{rs.label}</Badge>
                    </span>
                  </div>
                  <RunArtifacts run={run} />
                  {run.output && (
                    <details className="mt-1.5">
                      <summary className="text-[11px] text-text-muted cursor-pointer">Saída do agente</summary>
                      <pre className="mt-1 text-[11px] whitespace-pre-wrap text-text-muted bg-bg rounded p-2 border border-border max-h-64 overflow-auto">{run.output}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex justify-end pt-2 border-t border-border">
          <Button size="sm" variant="danger" disabled={busy} onClick={() => act(async () => { await api.delete(`/pipeline/cards/${card.id}`); onClose(); })}>
            Excluir card
          </Button>
        </div>
      </div>
    </Modal>
  );
}
