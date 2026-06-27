import { Loader2, GitBranch, GitPullRequest, Zap } from "lucide-react";
import type { PipelineCard } from "../../lib/types";
import { Badge } from "../shared/Badge";
import { UsageIndicator } from "./UsageIndicator";
import { CARD_STATUS_CONFIG } from "./constants";

interface Props {
  card: PipelineCard;
  projectName: string;
  onClick: () => void;
}

export function PipelineCardItem({ card, projectName, onClick }: Props) {
  const status = CARD_STATUS_CONFIG[card.status];
  const prCount = card.repos.filter((r) => r.prUrl).length;

  return (
    <div
      onClick={onClick}
      className="group bg-surface border border-border rounded-md p-3 cursor-pointer hover:border-accent/30 transition-colors space-y-2"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent shrink-0">
          {projectName}#{card.seqNumber}
        </span>
        {card.auto && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent" title="Modo automático">
            <Zap size={10} />
            Auto
          </span>
        )}
        <div className="ml-auto shrink-0">
          {card.status === "running"
            ? <span className="inline-flex items-center gap-1 text-blue-400 text-[10px]"><Loader2 size={11} className="animate-spin" />Executando</span>
            : <Badge variant={status.variant}>{status.label}</Badge>}
        </div>
      </div>

      <p className="text-sm font-medium text-text-primary leading-snug">{card.title}</p>

      <div className="flex items-center gap-2 text-[10px] text-text-muted">
        <span className="inline-flex items-center gap-1"><GitBranch size={10} />{card.repos.length}</span>
        {prCount > 0 && <span className="inline-flex items-center gap-1"><GitPullRequest size={10} />{prCount}</span>}
        {(card.implementationRetries + card.codeReviewRetries + card.e2eRetries) > 0 && (
          <span title="Retentativas">↻ {card.implementationRetries + card.codeReviewRetries + card.e2eRetries}</span>
        )}
        <UsageIndicator costUsd={card.totalCostUsd} totalTokens={card.totalTokens} contextPct={card.contextPct} className="ml-auto" />
      </div>
    </div>
  );
}
