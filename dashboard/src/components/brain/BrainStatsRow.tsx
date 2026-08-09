import { Card } from "../shared/Card";
import type { BrainStatus } from "../../lib/types";

function metric(status: BrainStatus, field: string): number {
  return status.metrics[0]?.fields[field] ?? 0;
}

export function BrainStatsRow({ status }: { status: BrainStatus }) {
  const ingestedToday =
    metric(status, "ingested:email") + metric(status, "ingested:calendar") + metric(status, "ingested:whatsapp") + metric(status, "ingested:slack");
  const chatter = metric(status, "chatter_filtered");
  const chatterRate = ingestedToday + chatter > 0 ? Math.round((chatter / (ingestedToday + chatter)) * 100) : 0;
  const triaged = metric(status, "triaged");
  const compiled = metric(status, "compiled");

  const tiles: { label: string; value: string | number; hint?: string }[] = [
    { label: "Ingeridas hoje", value: ingestedToday },
    { label: "Chatter filtrado", value: `${chatterRate}%`, hint: `${chatter} mensagens hoje` },
    { label: "Triadas hoje", value: triaged },
    { label: "Compiladas hoje", value: compiled },
    { label: "Threads em raw", value: status.counts.rawThreads },
    { label: "Páginas no wiki", value: status.counts.wikiPages },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map((tile) => (
        <Card key={tile.label} className="text-center py-3">
          <p className="text-lg font-semibold text-text-primary" title={tile.hint}>
            {tile.value}
          </p>
          <p className="text-xs text-text-muted">{tile.label}</p>
        </Card>
      ))}
    </div>
  );
}
