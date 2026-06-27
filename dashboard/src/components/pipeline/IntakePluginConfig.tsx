import { useState } from "react";
import { Play, Trash2 } from "lucide-react";
import type { IntakePluginType, PipelineIntakePlugin } from "../../lib/types";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";

interface Props {
  pipelineId: string;
  plugins: PipelineIntakePlugin[];
  onClose: () => void;
  onChanged: () => void;
}

export function IntakePluginConfig({ pipelineId, plugins, onClose, onChanged }: Props) {
  const [type, setType] = useState<IntakePluginType>("agent");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [skill, setSkill] = useState("");
  const [source, setSource] = useState("");
  const [cron, setCron] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/pipeline/${pipelineId}/plugins`, {
        type,
        name,
        config: type === "agent" ? { prompt, skill: skill || null, source: source || null } : {},
        cron: cron.trim() || null,
      });
      setName(""); setPrompt(""); setSkill(""); setSource(""); setCron("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar plugin");
    } finally {
      setBusy(false);
    }
  };

  const run = async (id: string) => {
    setBusy(true); setError(null); setInfo(null);
    try {
      await api.post(`/pipeline/plugins/${id}/run`);
      setInfo("Intake iniciado — os cards aparecerão no board.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao rodar intake");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await api.delete(`/pipeline/plugins/${id}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Origens de captação (intake)" size="lg">
      <div className="space-y-4">
        <div className="space-y-2">
          {plugins.length === 0 && <p className="text-xs text-text-muted">Nenhuma origem configurada. Cards manuais podem ser criados pelo botão "Novo card".</p>}
          {plugins.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border border-border rounded p-2 bg-surface">
              <Badge variant="accent">{p.type}</Badge>
              <span className="text-sm">{p.name}</span>
              {p.cron && <Badge variant="info">agendado: {p.cron}</Badge>}
              {!p.enabled && <Badge variant="default">desabilitado</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="secondary" disabled={busy || p.type === "manual"} onClick={() => run(p.id)} title="Rodar agora">
                  <Play size={13} />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(p.id)} title="Remover">
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <h4 className="text-xs font-semibold text-text-secondary">Nova origem</h4>
          <div className="grid grid-cols-2 gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as IntakePluginType)} className="bg-bg border border-border rounded p-2 text-sm">
              <option value="agent">Agente (fonte custom)</option>
              <option value="manual">Manual</option>
            </select>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" className="bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
          </div>
          {type === "agent" && (
            <>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt: o que o agente deve analisar e propor como cards" className="w-full h-24 bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
              <div className="grid grid-cols-2 gap-2">
                <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Skill (opcional)" className="bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
                <select value={source} onChange={(e) => setSource(e.target.value)} className="bg-bg border border-border rounded p-2 text-sm">
                  <option value="">Fonte: o agente investiga (repos/tools)</option>
                  <option value="execution_history">Fonte: histórico de execuções (padrões de uso)</option>
                </select>
              </div>
            </>
          )}
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="Cron (opcional, 5 campos, ex.: 0 9 * * 1) — agenda este intake" className="w-full bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
          {error && <p className="text-xs text-danger">{error}</p>}
          {info && <p className="text-xs text-success">{info}</p>}
          <div className="flex justify-end">
            <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={create}>Adicionar origem</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
