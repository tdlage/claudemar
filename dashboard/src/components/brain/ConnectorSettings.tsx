import type { BrainSchedulerName, BrainSettings } from "../../lib/types";

const LABELS: Record<BrainSchedulerName, { label: string; hint: string }> = {
  gmail: { label: "Gmail", hint: "polling incremental por conta (history.list)" },
  calendar: { label: "Calendar", hint: "polling incremental por conta (syncToken)" },
  ingest: { label: "Ingestão", hint: "consome o stream e grava em raw/" },
  triage: { label: "Triagem", hint: "classifica threads com LLM — ligue após validar a ingestão" },
  compile: { label: "Compilação", hint: "compila conhecimento no wiki — ligue após validar a triagem" },
  index: { label: "Índice T3", hint: "indexa o wiki no Qdrant (incremental + reconcile noturno)" },
  digest: { label: "Digest diário", hint: "gera state/digest/ com vencidos, prazos e alertas" },
  whatsapp: { label: "WhatsApp", hint: "monitora a sessão do bridge (mensagens chegam por webhook)" },
  slack: { label: "Slack", hint: "mantém o socket conectado e faz catch-up por canal" },
  distill: { label: "Distilação", hint: "extrai lições de threads encerradas para wiki/lessons — usa LLM" },
  lint: { label: "Lint semanal", hint: "relatório de saúde do wiki em state/lint — propõe, não altera" },
  freshness: { label: "FreshnessWatch", hint: "vigia heartbeats, filas e conectores mudos; gera alertas" },
};

const CADENCE_KEYS: Partial<Record<BrainSchedulerName, keyof BrainSettings["cadences"]>> = {
  gmail: "gmailMs",
  calendar: "calendarMs",
  ingest: "ingestMs",
  triage: "triageMs",
  compile: "compileMs",
  index: "indexMs",
  whatsapp: "whatsappMs",
  slack: "slackMs",
  freshness: "freshnessMs",
};

const FIXED_TIMES: Partial<Record<BrainSchedulerName, string>> = {
  digest: "07:00",
  distill: "04:00",
  lint: "05:00 (semanal)",
};

export function ConnectorSettings({
  settings,
  patch,
}: {
  settings: BrainSettings;
  patch: (updater: (prev: BrainSettings) => BrainSettings) => void;
}) {
  return (
    <div className="space-y-2">
      {(Object.keys(LABELS) as BrainSchedulerName[]).map((name) => (
        <div key={name} className="flex items-center gap-3 bg-bg border border-border rounded-md px-3 py-2">
          <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
            <input
              type="checkbox"
              checked={settings.schedulers[name]}
              onChange={(e) =>
                patch((prev) => ({
                  ...prev,
                  schedulers: { ...prev.schedulers, [name]: e.target.checked },
                }))
              }
            />
            <span className="text-sm text-text-primary">{LABELS[name].label}</span>
            <span className="text-xs text-text-muted truncate">{LABELS[name].hint}</span>
          </label>
          <div className="flex items-center gap-1.5 shrink-0">
            {CADENCE_KEYS[name] ? (
              <>
                <input
                  type="number"
                  min={5}
                  value={Math.round(settings.cadences[CADENCE_KEYS[name]!] / 1000)}
                  onChange={(e) => {
                    const seconds = Number(e.target.value);
                    if (!Number.isFinite(seconds) || seconds < 0) return;
                    patch((prev) => ({
                      ...prev,
                      cadences: { ...prev.cadences, [CADENCE_KEYS[name]!]: seconds * 1000 },
                    }));
                  }}
                  onBlur={() =>
                    patch((prev) => ({
                      ...prev,
                      cadences: {
                        ...prev.cadences,
                        [CADENCE_KEYS[name]!]: Math.max(5000, prev.cadences[CADENCE_KEYS[name]!] || 5000),
                      },
                    }))
                  }
                  className="w-20 bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
                />
                <span className="text-xs text-text-muted">s</span>
              </>
            ) : (
              <span className="text-xs text-text-muted font-mono">{FIXED_TIMES[name] ?? ""}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
