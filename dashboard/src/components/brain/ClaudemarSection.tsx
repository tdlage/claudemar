import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "../../lib/api";
import { Badge } from "../shared/Badge";
import { useToast } from "../shared/Toast";
import { useBrainData, useTenants } from "../../hooks/useBrain";
import type { BrainClaudemarSettings, BrainClaudemarTarget, BrainSettings } from "../../lib/types";

const KIND_LABELS: Record<BrainClaudemarTarget["kind"], string> = {
  orchestrator: "orquestrador",
  project: "projeto",
  agent: "agente",
};

const TOGGLES: { key: keyof Omit<BrainClaudemarSettings, "tenants" | "excludedTargets">; label: string }[] = [
  { key: "transcripts", label: "Ler os transcripts das sessões (Claude SDK e Codex) para mensagens intermediárias e ações detalhadas" },
  { key: "orphanSessions", label: "Incluir sessões que só existem nos transcripts (ex.: Claude Code aberto direto no terminal)" },
  { key: "includeOtherUsers", label: "Incluir execuções e cards do pipeline de outros usuários do dashboard" },
  { key: "pipeline", label: "Sincronizar os cards do pipeline de cada projeto" },
  { key: "commits", label: "Ingerir commits dos repositórios dos projetos e agentes" },
];

const selectClass =
  "bg-bg border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent max-w-[14rem]";

export function ClaudemarSection({
  settings,
  patch,
}: {
  settings: BrainSettings;
  patch: (updater: (prev: BrainSettings) => BrainSettings) => void;
}) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { tenants } = useTenants();
  const { data, setData, loading, error } = useBrainData<BrainClaudemarTarget[]>("/brain/claudemar/targets");
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (target: BrainClaudemarTarget, body: { tenant?: string | null; excluded?: boolean }) => {
    setBusy(target.key);
    try {
      const next = await api.put<BrainClaudemarTarget>(`/brain/claudemar/targets/${encodeURIComponent(target.key)}`, body);
      setData((prev) => (prev ?? []).map((t) => (t.key === next.key ? next : t)));
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Cada execução do orquestrador, dos projetos e dos agentes vira uma thread em raw/claudemar (pedido, respostas e
        ações), assim como os cards do pipeline e os commits. Cada alvo ganha uma página em wiki/projects com as
        seções automáticas de atividade e de cards do pipeline; decisões e implementações entram pela compilação. O histórico
        anterior vem pelo backfill. Marcar "ignorar" remove do brain tudo o que já veio do alvo.
      </p>
      <div className="space-y-2">
        {TOGGLES.map((toggle) => (
          <label key={toggle.key} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={settings.claudemar[toggle.key]}
              onChange={(e) =>
                patch((prev) => ({ ...prev, claudemar: { ...prev.claudemar, [toggle.key]: e.target.checked } }))
              }
            />
            {toggle.label}
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-text-muted">Projetos e agentes</p>
        <p className="text-[10px] text-text-muted">
          O contexto define a árvore do wiki onde o conhecimento do alvo é compilado. Sem escolha, vale o contexto com o
          mesmo nome do projeto/agente ou o pessoal. Ao mudar, as páginas derivadas só deste alvo mudam junto — escolha
          antes do backfill.
        </p>
        {loading && !data && <p className="text-xs text-text-muted">Carregando…</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="divide-y divide-border border border-border rounded-md">
          {(data ?? []).map((target) => (
            <div key={target.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className={`text-sm flex-1 min-w-[10rem] ${target.excluded ? "text-text-muted line-through" : "text-text-primary"}`}>
                {target.name === "orchestrator" ? "Orquestrador" : target.name}
              </span>
              <Badge>{KIND_LABELS[target.kind]}</Badge>
              <select
                value={target.mappedTenant ?? ""}
                disabled={busy === target.key}
                onChange={(e) => update(target, { tenant: e.target.value || null })}
                className={selectClass}
              >
                <option value="">automático ({target.tenant})</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={target.excluded}
                  disabled={busy === target.key}
                  onChange={(e) => {
                    const excluded = e.target.checked;
                    if (excluded && !confirm(`Ignorar ${target.label}? Threads, página e conteúdo compilado só dele serão apagados do brain.`)) return;
                    void update(target, { excluded });
                  }}
                />
                ignorar
              </label>
              {target.pageExists && (
                <button
                  title="Abrir página do alvo"
                  onClick={() => navigate(`/second-brain/wiki/${target.pagePath.replace(/^wiki\//, "").replace(/\.md$/, "")}`)}
                  className="p-1 rounded text-text-muted hover:bg-accent/10 transition-colors"
                >
                  <ExternalLink size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
