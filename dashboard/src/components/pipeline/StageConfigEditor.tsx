import { useEffect, useState } from "react";
import type { PipelineStage, PipelineStageConfig } from "../../lib/types";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { STAGE_LABEL } from "./constants";

interface Props {
  pipelineId: string;
  stageConfigs: PipelineStageConfig[];
  onClose: () => void;
  onSaved: () => void;
}

export function StageConfigEditor({ pipelineId, stageConfigs, onClose, onSaved }: Props) {
  const ordered = [...stageConfigs].sort((a, b) => a.stage.localeCompare(b.stage));
  const [stage, setStage] = useState<PipelineStage>(ordered[0]?.stage ?? "requirement");
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [skill, setSkill] = useState("");
  const [agentName, setAgentName] = useState("");
  const [timeoutMin, setTimeoutMin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ name: string; description: string }[]>("/projects/claude-skills").then(setSkills).catch(() => {});
  }, []);

  useEffect(() => {
    const cfg = stageConfigs.find((c) => c.stage === stage);
    setPromptTemplate(cfg?.promptTemplate ?? "");
    setSkill(cfg?.skill ?? "");
    setAgentName(cfg?.agentName ?? "");
    setTimeoutMin(cfg && cfg.timeoutMs != null ? String(Math.round(cfg.timeoutMs / 60000)) : "");
  }, [stage, stageConfigs]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/pipeline/${pipelineId}/stages/${stage}`, {
        promptTemplate,
        skill: skill || null,
        agentName: agentName || null,
        timeoutMs: timeoutMin.trim() ? Math.max(0, Number(timeoutMin)) * 60000 : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Configurar etapas" size="lg">
      <div className="space-y-3">
        <select value={stage} onChange={(e) => setStage(e.target.value as PipelineStage)} className="w-full bg-bg border border-border rounded p-2 text-sm">
          {ordered.map((c) => <option key={c.stage} value={c.stage}>{STAGE_LABEL[c.stage]}</option>)}
        </select>

        <div>
          <label className="text-xs text-text-secondary">Prompt da etapa</label>
          <textarea value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} className="w-full h-48 bg-bg border border-border rounded p-2 text-sm font-mono focus:outline-none focus:border-accent" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-text-secondary">Skill</label>
            <select value={skill} onChange={(e) => setSkill(e.target.value)} className="w-full bg-bg border border-border rounded p-2 text-sm">
              <option value="">(nenhuma)</option>
              {skills.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary">Agente (persona, opcional)</label>
            <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="ex.: pragmatic-code-reviewer" className="w-full bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
          </div>
        </div>

        <div>
          <label className="text-xs text-text-secondary">Timeout (minutos — vazio = padrão global, 0 = sem limite)</label>
          <input type="number" min="0" value={timeoutMin} onChange={(e) => setTimeoutMin(e.target.value)} placeholder={`padrão`} className="w-full bg-bg border border-border rounded p-2 text-sm focus:outline-none focus:border-accent" />
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Fechar</Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>Salvar etapa</Button>
        </div>
      </div>
    </Modal>
  );
}
