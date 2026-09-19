import { TerminalSquare } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-symbol" aria-hidden="true">
        <TerminalSquare size={22} strokeWidth={1.5} />
      </span>
      {!compact && (
        <span>
          <span className="brand-name">
            claudemar<span className="text-accent">_</span>
          </span>
          <span className="brand-caption">SEU ESPAÇO DE TRABALHO</span>
        </span>
      )}
    </span>
  );
}
