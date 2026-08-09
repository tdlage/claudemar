import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Mail, Calendar, Inbox, Filter, Hammer, Pause, Play, RefreshCw, MessageCircle, Hash } from "lucide-react";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import { tenantVariant } from "../../lib/tenantVariant";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { BrainSchedulerStatus, GoogleAccountStatus } from "../../lib/types";

const ICONS: Record<string, typeof Mail> = {
  gmail: Mail,
  calendar: Calendar,
  ingest: Inbox,
  triage: Filter,
  compile: Hammer,
  whatsapp: MessageCircle,
  slack: Hash,
};

const LABELS: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  ingest: "Ingestão",
  triage: "Triagem",
  compile: "Compilação",
  whatsapp: "WhatsApp",
  slack: "Slack",
};

export function ConnectorCard({
  scheduler,
  accounts,
  onChanged,
}: {
  scheduler: BrainSchedulerStatus;
  accounts: GoogleAccountStatus[];
  onChanged: () => void;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[scheduler.name] ?? Inbox;

  const dotColor = !scheduler.enabled
    ? "bg-text-muted"
    : scheduler.disabledReason
      ? "bg-warning"
      : scheduler.lastError
        ? "bg-danger"
        : "bg-success";

  const action = async (verb: "pause" | "resume" | "run-now") => {
    setBusy(true);
    try {
      await api.post(`/brain/connectors/${scheduler.name}/${verb}`, {});
      if (verb === "run-now") addToast("success", `${LABELS[scheduler.name]}: execução concluída`);
      onChanged();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <Icon size={15} className="text-text-muted" />
        <span className="text-sm font-medium text-text-primary flex-1">{LABELS[scheduler.name]}</span>
        {scheduler.inFlight && <Badge variant="accent">executando</Badge>}
        {!scheduler.enabled && <Badge>pausado</Badge>}
        <button
          title={scheduler.enabled ? "Pausar" : "Retomar"}
          disabled={busy}
          onClick={() => action(scheduler.enabled ? "pause" : "resume")}
          className="p-1.5 rounded text-text-muted hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          {scheduler.enabled ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          title="Executar agora"
          disabled={busy || scheduler.inFlight}
          onClick={() => action("run-now")}
          className="p-1.5 rounded text-text-muted hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
        </button>
      </div>
      {scheduler.disabledReason && <p className="text-xs text-warning">{scheduler.disabledReason}</p>}
      {scheduler.lastError && !scheduler.disabledReason && (
        <p className="text-xs text-danger truncate" title={scheduler.lastError}>
          {scheduler.lastError}
        </p>
      )}
      {scheduler.lastHeartbeat && (
        <p className="text-xs text-text-muted">
          último ciclo {formatDistanceToNow(new Date(scheduler.lastHeartbeat), { addSuffix: true })}
        </p>
      )}
      {accounts.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border">
          {accounts.map((account) => (
            <div key={account.email} className="flex items-center gap-2 text-xs">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  account.reauthRequired ? "bg-danger" : account.connected ? "bg-success" : "bg-text-muted"
                }`}
              />
              <span className="text-text-secondary truncate flex-1">{account.email}</span>
              <Badge variant={tenantVariant(account.tenant)}>{account.tenant}</Badge>
              {account.reauthRequired && <Badge variant="danger">reautorizar</Badge>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
