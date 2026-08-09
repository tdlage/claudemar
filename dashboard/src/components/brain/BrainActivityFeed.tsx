import { formatDistanceToNow } from "date-fns";
import { Activity, Inbox, Filter, Hammer, ShieldAlert, Plug, DatabaseBackup, DatabaseZap, FileClock, GraduationCap, Stethoscope, BellRing } from "lucide-react";
import { Card } from "../shared/Card";
import type { BrainActivityItem } from "../../lib/types";

const KIND_ICONS = {
  ingest: Inbox,
  triage: Filter,
  compile: Hammer,
  quarantine: ShieldAlert,
  connector: Plug,
  backfill: DatabaseBackup,
  index: DatabaseZap,
  digest: FileClock,
  distill: GraduationCap,
  lint: Stethoscope,
  alert: BellRing,
} as const;

export function BrainActivityFeed({
  activity,
  onOpenPath,
}: {
  activity: BrainActivityItem[];
  onOpenPath: (path: string) => void;
}) {
  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <Activity size={15} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">Atividade</h3>
      </div>
      {activity.length === 0 ? (
        <p className="text-xs text-text-muted">Nada ainda — a atividade do pipeline aparece aqui em tempo real.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {activity.map((item) => {
            const Icon = KIND_ICONS[item.kind] ?? Activity;
            return (
              <div key={`${item.at}-${item.kind}-${item.label}`} className="flex items-start gap-2 text-xs">
                <Icon size={13} className={`mt-0.5 shrink-0 ${item.kind === "quarantine" || item.kind === "alert" ? "text-warning" : "text-text-muted"}`} />
                {item.path ? (
                  <button
                    onClick={() => onOpenPath(item.path!)}
                    className="text-left text-text-secondary hover:text-accent transition-colors flex-1 truncate"
                    title={item.label}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span className="text-text-secondary flex-1 truncate" title={item.label}>
                    {item.label}
                  </span>
                )}
                <span className="text-text-muted shrink-0">
                  {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
