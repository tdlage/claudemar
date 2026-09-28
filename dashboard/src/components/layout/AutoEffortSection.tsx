import { useId } from "react";
import { Gauge, TrendingDown, TrendingUp, Scale, type LucideIcon } from "lucide-react";
import { useComplexityEnabled } from "../terminal/complexity";
import type { AutoEffortOffset } from "../../lib/types";

interface OffsetOption {
  value: AutoEffortOffset;
  title: string;
  description: string;
  example: string;
  icon: LucideIcon;
}

const OPTIONS: OffsetOption[] = [
  {
    value: -1,
    title: "Mais econômico",
    description: "Um nível abaixo do recomendado. Respostas mais rápidas e menor consumo; Low continua Low.",
    example: "High → Medium",
    icon: TrendingDown,
  },
  {
    value: 0,
    title: "Como recomendado",
    description: "Usa exatamente o nível que o Jev recomendar para cada prompt.",
    example: "High → High",
    icon: Scale,
  },
  {
    value: 1,
    title: "Mais caprichado",
    description: "Um nível acima do recomendado. Mais raciocínio; Max vira Ultracode no Claude e fica em Max no Codex.",
    example: "High → Extra high",
    icon: TrendingUp,
  },
];

interface AutoEffortSectionProps {
  value: AutoEffortOffset;
  saving: boolean;
  message: { type: "ok" | "err"; text: string } | null;
  onChange: (value: AutoEffortOffset) => void;
}

export function AutoEffortSection({ value, saving, message, onChange }: AutoEffortSectionProps) {
  const name = useId();
  const complexityEnabled = useComplexityEnabled();

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2 flex items-center gap-2">
        <Gauge size={14} className="text-text-muted" /> Esforço automático
      </h2>
      <p className="text-sm text-text-muted">
        Quando o esforço está em <strong>Auto</strong>, o Jev avalia a complexidade de cada prompt e escolhe o nível. Calibre aqui se prefere que ele erre para menos ou para mais.
      </p>
      {!complexityEnabled && (
        <p className="text-xs text-warning">O Jev não está configurado neste servidor — a calibração passa a valer quando o esforço automático estiver disponível.</p>
      )}
      <div role="radiogroup" aria-label="Calibração do esforço automático" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {OPTIONS.map((option) => {
          const checked = option.value === value;
          const Icon = option.icon;
          return (
            <label
              key={option.value}
              className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                checked ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-border-hover hover:bg-surface-hover"
              } ${saving ? "opacity-70" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={saving}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2">
                <Icon size={16} className={checked ? "text-accent" : "text-text-muted"} aria-hidden="true" />
                <span className="text-sm font-medium text-text-primary">{option.title}</span>
              </span>
              <span className="text-xs text-text-muted">{option.description}</span>
              <span className={`mt-auto self-start rounded px-1.5 py-0.5 font-mono text-[11px] ${checked ? "bg-accent/20 text-text-primary" : "bg-surface-hover text-text-secondary"}`}>
                {option.example}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex justify-end min-h-4" aria-live="polite">
        {saving ? (
          <span className="text-xs text-text-muted">Salvando…</span>
        ) : message ? (
          <span className={`text-xs ${message.type === "ok" ? "text-success" : "text-danger"}`}>{message.text}</span>
        ) : null}
      </div>
    </section>
  );
}
