import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Pin, CheckCheck } from "lucide-react";
import { api } from "../../lib/api";
import { Badge } from "../shared/Badge";
import { tenantVariant } from "../../lib/tenantVariant";
import { useToast } from "../shared/Toast";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function reviewOverdue(fm: Record<string, unknown>): boolean {
  const reviewedAt = str(fm.reviewed_at);
  const window = str(fm.review_window);
  if (!reviewedAt || !window) return false;
  const match = /^(\d+)(d|m|y)$/.exec(window);
  if (!match) return false;
  const amount = Number(match[1]);
  const days = match[2] === "d" ? amount : match[2] === "m" ? amount * 30 : amount * 365;
  return Date.now() - new Date(reviewedAt).getTime() > days * 86_400_000;
}

export function WikiPageHeader({
  fm,
  path,
  onReviewed,
}: {
  fm: Record<string, unknown>;
  path: string;
  onReviewed?: () => void;
}) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [reviewing, setReviewing] = useState(false);

  const markReviewed = async () => {
    setReviewing(true);
    try {
      await api.post("/brain/wiki/review", { path });
      addToast("success", "Página marcada como revisada");
      onReviewed?.();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  };
  const status = str(fm.status);
  const confidence = str(fm.confidence);
  const salience = num(fm.salience);
  const sources = Array.isArray(fm.sources) ? (fm.sources as string[]) : [];
  const related = Array.isArray(fm.related) ? (fm.related as string[]) : [];
  const aliases = Array.isArray(fm.aliases) ? (fm.aliases as string[]) : [];
  const updatedAt = str(fm.updated_at);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-text-primary flex-1 min-w-48">
          {str(fm.title) || path}
        </h2>
        {str(fm.type) && <Badge variant="accent">{str(fm.type)}</Badge>}
        {status && (
          <Badge variant={status === "active" ? "success" : status === "archived" ? "default" : "default"}>
            {status}
          </Badge>
        )}
        {confidence && (
          <span title={`derivada de ${num(fm.independent_sources) ?? "?"} fonte(s) independente(s)`}>
            <Badge variant={confidence === "high" ? "success" : confidence === "medium" ? "info" : "warning"}>
              {confidence}
            </Badge>
          </span>
        )}
        {str(fm.tenant) && <Badge variant={tenantVariant(str(fm.tenant))}>{str(fm.tenant)}</Badge>}
        {fm.contains_pii === 1 && <Badge variant="warning">PII</Badge>}
        {reviewOverdue(fm) && (
          <>
            <Badge variant="warning">revisão pendente</Badge>
            <button
              onClick={markReviewed}
              disabled={reviewing}
              className="flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
              title="Re-arma a janela de revisão desta página"
            >
              <CheckCheck size={13} /> marcar como revisada
            </button>
          </>
        )}
        {fm.pinned === true && <Pin size={13} className="text-accent" />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {salience !== null && <span>salience {salience}</span>}
        {updatedAt && (
          <span>
            atualizado{" "}
            {(() => {
              try {
                return formatDistanceToNow(new Date(updatedAt), { addSuffix: true });
              } catch {
                return updatedAt;
              }
            })()}
          </span>
        )}
        {aliases.length > 0 && <span title={aliases.join(" · ")}>{aliases.length} alias(es)</span>}
      </div>
      {related.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-muted">relacionados:</span>
          {related.map((rel) => (
            <button
              key={rel}
              onClick={() => navigate(`/second-brain/wiki/${rel.replace(/^wiki\//, "").replace(/\.md$/, "")}`)}
              className="text-accent hover:underline"
            >
              {rel}
            </button>
          ))}
        </div>
      )}
      {sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-muted">fontes:</span>
          {sources.map((source) => (
            <button
              key={source}
              onClick={() => navigate(`/second-brain/raw/${source.replace(/^raw\//, "").replace(/\.md$/, "")}`)}
              className="text-accent hover:underline font-mono"
            >
              {source.split("/").pop()}
            </button>
          ))}
        </div>
      ) : (
        str(fm.type) !== "" && <p className="text-xs text-danger">sem fontes — violação de schema</p>
      )}
    </div>
  );
}
