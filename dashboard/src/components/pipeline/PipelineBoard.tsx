import { useState } from "react";
import { Plus, Settings, Workflow } from "lucide-react";
import { api } from "../../lib/api";
import { usePipeline, usePipelineCards } from "../../hooks/usePipeline";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { PIPELINE_STAGES } from "./constants";
import { PipelineCardItem } from "./PipelineCardItem";
import { PipelineCardDetail } from "./PipelineCardDetail";
import { StageConfigEditor } from "./StageConfigEditor";
import { IntakePluginConfig } from "./IntakePluginConfig";

interface Props {
  projectName: string;
}

function NewCardModal({ pipelineId, repos, onClose, onCreated }: { pipelineId: string; repos: string[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string[]>(repos);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRepo = (r: string) => setSelected((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);

  const create = async () => {
    if (!title.trim() || selected.length === 0) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/pipeline/${pipelineId}/cards`, { title, intakeInput: input, repos: selected, auto });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Novo card" size="lg">
      <div className="space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da tarefa" className="w-full bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Descrição / contexto (entrada para a etapa de requisito)" className="w-full h-28 bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
        <div>
          <label className="text-xs text-text-secondary">Repositórios-alvo</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {repos.map((r) => (
              <button
                key={r}
                onClick={() => toggleRepo(r)}
                className={`px-2 py-1 rounded text-xs border transition-colors ${selected.includes(r) ? "bg-accent/15 border-accent/40 text-accent" : "bg-bg border-border text-text-muted"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Automático (passa por todas as etapas sem aprovação manual)
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button size="sm" variant="primary" disabled={busy || !title.trim() || selected.length === 0} onClick={create}>Criar card</Button>
        </div>
      </div>
    </Modal>
  );
}

function CreatePipeline({ projectName, repos, onCreated }: { projectName: string; repos: string[]; onCreated: () => void }) {
  const [baseBranch, setBaseBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/pipeline/projects/${projectName}`, { defaultBaseBranch: baseBranch });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar esteira");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-6 max-w-md">
      <div className="flex items-center gap-2 mb-2">
        <Workflow size={18} className="text-accent" />
        <h3 className="text-sm font-semibold">Criar esteira de desenvolvimento</h3>
      </div>
      <p className="text-xs text-text-muted mb-3">
        Cada card é executado por um agente de IA através das etapas: Requisito → Plano → Implementação → Code Review → E2E → Pull Request.
      </p>
      {repos.length === 0 && <p className="text-xs text-danger mb-2">Este projeto não tem repositórios git — adicione um repositório antes.</p>}
      <label className="text-xs text-text-secondary">Branch base</label>
      <input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} className="w-full bg-bg border border-border rounded p-2 text-sm mb-3 focus:outline-none focus:border-accent" />
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <Button size="sm" variant="primary" disabled={busy || repos.length === 0} onClick={create}>Criar esteira</Button>
    </div>
  );
}

export function PipelineBoard({ projectName }: Props) {
  const { bundle, loading, refresh } = usePipeline(projectName);
  const pipelineId = bundle?.pipeline?.id;
  const { cards } = usePipelineCards(pipelineId);

  const [showNewCard, setShowNewCard] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  if (loading && !bundle) return <p className="text-text-muted">Carregando...</p>;

  if (!bundle?.pipeline) {
    return <CreatePipeline projectName={projectName} repos={bundle?.repos ?? []} onCreated={refresh} />;
  }

  const pipeline = bundle.pipeline;
  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="primary" onClick={() => setShowNewCard(true)}><Plus size={14} className="mr-1" />Novo card</Button>
        <Button size="sm" variant="secondary" onClick={() => setShowPlugins(true)}>Origens</Button>
        <Button size="sm" variant="secondary" onClick={() => setShowStages(true)}><Settings size={14} className="mr-1" />Etapas</Button>
        <span className="text-xs text-text-muted ml-auto">base: {pipeline.defaultBaseBranch}</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {PIPELINE_STAGES.map((stage) => {
          const stageCards = cards.filter((c) => c.stage === stage.key);
          return (
            <div key={stage.key} className="shrink-0 w-64 bg-bg/40 rounded-lg border border-border" style={{ borderTopColor: stage.color, borderTopWidth: 2 }}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="text-xs font-medium">{stage.label}</span>
                <span className="ml-auto text-[10px] text-text-muted">{stageCards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[60px]">
                {stageCards.map((card) => (
                  <PipelineCardItem key={card.id} card={card} projectName={projectName} onClick={() => setSelectedCardId(card.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {showNewCard && <NewCardModal pipelineId={pipeline.id} repos={bundle.repos} onClose={() => setShowNewCard(false)} onCreated={refresh} />}
      {showStages && <StageConfigEditor pipelineId={pipeline.id} stageConfigs={bundle.stageConfigs} onClose={() => setShowStages(false)} onSaved={refresh} />}
      {showPlugins && <IntakePluginConfig pipelineId={pipeline.id} plugins={bundle.plugins} onClose={() => setShowPlugins(false)} onChanged={refresh} />}
      {selectedCard && <PipelineCardDetail card={selectedCard} projectName={projectName} availableRepos={bundle.repos} onClose={() => setSelectedCardId(null)} />}
    </div>
  );
}
