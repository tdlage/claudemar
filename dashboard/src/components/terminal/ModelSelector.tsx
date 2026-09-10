import type { ModelOption } from "../../lib/types";

export function ModelSelector({ models, value, disabled, onChange }: {
  models: ModelOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const providers = [...new Map(models.map((model) => [model.providerId, model.providerLabel])).entries()];
  const missing = !models.some((model) => model.model === value);
  return (
    <select aria-label="Modelo" title="Modelo e provider usados nesta conversa" value={value} disabled={disabled || !models.length}
      onChange={(event) => onChange(event.target.value)}
      className="text-xs bg-surface border border-border rounded-md px-2 py-1 text-text-primary max-w-40 disabled:opacity-50">
      {missing && <option value={value}>{value ? "Modelo indisponível — escolha outro" : "Nenhum provider autenticado"}</option>}
      {providers.map(([id, label]) => <optgroup key={id} label={label}>
        {models.filter((model) => model.providerId === id).map((model) => <option key={model.model} value={model.model}>{model.displayName}</option>)}
      </optgroup>)}
    </select>
  );
}
