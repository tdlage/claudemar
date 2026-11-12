import { PlugZap } from "lucide-react";
import type { BrainConnectionIssue } from "../../lib/types";

const CONNECTOR_LABELS: Record<BrainConnectionIssue["connector"], string> = {
  google: "Google",
  whatsapp: "WhatsApp",
  slack: "Slack",
};

export function ConnectionIssuesCard({
  issues,
  onOpenSettings,
}: {
  issues: BrainConnectionIssue[];
  onOpenSettings?: () => void;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="bg-warning/10 border border-warning/30 rounded-md px-3 py-2 space-y-1">
      <div className="flex items-center gap-2 text-xs font-semibold text-warning">
        <PlugZap size={14} />
        <span className="flex-1">Conexões que precisam de atenção ({issues.length})</span>
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="text-xs font-medium text-accent hover:underline">
            Abrir Configurações
          </button>
        )}
      </div>
      {issues.map((issue) => (
        <p key={`${issue.connector}:${issue.account}:${issue.message}`} className="text-xs text-text-secondary">
          <span className="font-medium text-text-primary">{CONNECTOR_LABELS[issue.connector]}</span> · {issue.account} — {issue.message}
        </p>
      ))}
    </div>
  );
}
