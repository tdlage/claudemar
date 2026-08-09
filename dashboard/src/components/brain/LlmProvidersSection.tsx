import { useEffect, useState } from "react";
import { Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import type { BrainLlmProvider, BrainSettings } from "../../lib/types";

const inputClass =
  "w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";
const inputMonoClass = `${inputClass} font-mono`;

interface EnvKeyStatus {
  key: string;
  present: boolean;
}

export function LlmProvidersSection({
  settings,
  patch,
}: {
  settings: BrainSettings;
  patch: (updater: (prev: BrainSettings) => BrainSettings) => void;
}) {
  const [envKeys, setEnvKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api
      .get<EnvKeyStatus[]>("/system/env")
      .then((keys) => {
        const map: Record<string, boolean> = {};
        for (const k of keys) map[k.key] = k.present;
        setEnvKeys(map);
      })
      .catch(() => {});
  }, []);

  const patchProvider = (id: string, update: Partial<BrainLlmProvider>) => {
    patch((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: prev.llm.providers.map((p) => (p.id === id ? { ...p, ...update } : p)),
      },
    }));
  };

  const patchFeature = (id: string, feature: keyof BrainLlmProvider["features"], value: boolean) => {
    patch((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: prev.llm.providers.map((p) =>
          p.id === id ? { ...p, features: { ...p.features, [feature]: value } } : p,
        ),
      },
    }));
  };

  const removeProvider = (id: string) => {
    patch((prev) => ({
      ...prev,
      llm: { ...prev.llm, providers: prev.llm.providers.filter((p) => p.id !== id) },
    }));
  };

  const addProvider = () => {
    const id = `provider-${Date.now().toString(36)}`;
    patch((prev) => ({
      ...prev,
      llm: {
        ...prev.llm,
        providers: [
          ...prev.llm.providers,
          {
            id,
            label: "Novo provedor",
            baseUrl: "",
            apiKeyEnv: "MINHA_API_KEY",
            features: { batch: false, caching: false, structuredOutputs: false },
          },
        ],
      },
    }));
  };

  const patchStage = (
    stage: "triage" | "compile" | "selector" | "distill" | "lint",
    update: Partial<BrainSettings["llm"]["triage"]>,
  ) => {
    patch((prev) => ({
      ...prev,
      llm: { ...prev.llm, [stage]: { ...prev.llm[stage], ...update } },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {settings.llm.providers.map((provider) => {
          const keyPresent = envKeys[provider.apiKeyEnv];
          return (
            <div key={provider.id} className="bg-bg border border-border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={provider.label}
                  onChange={(e) => patchProvider(provider.id, { label: e.target.value })}
                  className={`${inputClass} flex-1`}
                  placeholder="Nome do provedor"
                />
                <button
                  onClick={() => removeProvider(provider.id)}
                  className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                  title="Remover provedor"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    Base URL (Anthropic-compatível; vazio = api.anthropic.com)
                  </label>
                  <input
                    type="text"
                    value={provider.baseUrl}
                    onChange={(e) => patchProvider(provider.id, { baseUrl: e.target.value })}
                    className={inputMonoClass}
                    placeholder="https://…"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Env var da API key</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={provider.apiKeyEnv}
                      onChange={(e) => patchProvider(provider.id, { apiKeyEnv: e.target.value.toUpperCase() })}
                      className={inputMonoClass}
                    />
                    {keyPresent === true && (
                      <span title="Env var presente">
                        <CheckCircle2 size={15} className="text-success shrink-0" />
                      </span>
                    )}
                    {keyPresent === false && (
                      <span title="Env var ausente — defina em Settings → Variáveis de ambiente">
                        <XCircle size={15} className="text-warning shrink-0" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ["batch", "Batch API (-50%)"],
                    ["caching", "Prompt caching"],
                    ["structuredOutputs", "Structured outputs"],
                  ] as const
                ).map(([feature, label]) => (
                  <label key={feature} className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={provider.features[feature]}
                      onChange={(e) => patchFeature(provider.id, feature, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        <button
          onClick={addProvider}
          className="flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          <Plus size={13} /> Adicionar provedor
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(
          [
            ["triage", "Triagem"],
            ["compile", "Compilação"],
            ["selector", "Seletor (busca)"],
            ["distill", "Distilação"],
            ["lint", "Lint"],
          ] as const
        ).map(([stage, label]) => (
          <div key={stage} className="bg-bg border border-border rounded-md p-3 space-y-2">
            <p className="text-xs font-semibold text-text-primary">{label}</p>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Provedor</label>
              <select
                value={settings.llm[stage].providerId}
                onChange={(e) => patchStage(stage, { providerId: e.target.value })}
                className={inputClass}
              >
                {settings.llm.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Modelo</label>
              <input
                type="text"
                value={settings.llm[stage].model}
                onChange={(e) => patchStage(stage, { model: e.target.value })}
                className={inputMonoClass}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
