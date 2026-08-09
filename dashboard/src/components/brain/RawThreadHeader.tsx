import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Paperclip, AlertCircle } from "lucide-react";
import { Card } from "../shared/Card";
import { Badge } from "../shared/Badge";
import type { RawThreadFrontmatter } from "../../lib/types";

const RELEVANCE_META: Record<number, { label: string; variant: "default" | "info" | "accent" | "warning" }> = {
  0: { label: "ruído", variant: "default" },
  1: { label: "transacional", variant: "info" },
  2: { label: "relevante", variant: "accent" },
  3: { label: "crítico", variant: "warning" },
};

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtRange(from: string, to: string): string {
  try {
    const a = format(new Date(from), "dd/MM/yyyy HH:mm");
    const b = format(new Date(to), "dd/MM/yyyy HH:mm");
    return a === b ? a : `${a} — ${b}`;
  } catch {
    return `${from} — ${to}`;
  }
}

export function RawThreadHeader({ fm }: { fm: RawThreadFrontmatter }) {
  const navigate = useNavigate();
  const rel = fm.triage ? RELEVANCE_META[fm.triage.relevance] : null;

  return (
    <Card className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-text-primary flex-1 min-w-48">{fm.subject || "(sem assunto)"}</h2>
        <Badge variant="accent">{fm.channel}</Badge>
        {fm.subchannel === "group" && <Badge>grupo</Badge>}
        <Badge variant={fm.tenant === "biosoft" ? "info" : "default"}>{fm.tenant}</Badge>
        {fm.contains_pii === 1 && <Badge variant="warning">PII</Badge>}
        {rel && (
          <Badge variant={rel.variant}>
            {rel.label}
            {fm.triage?.action_required ? " · ação" : ""}
          </Badge>
        )}
        {!fm.triage && <Badge>sem triagem</Badge>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>{fmtRange(fm.occurred_from, fm.occurred_to)}</span>
        <span>ingerido {formatDistanceToNow(new Date(fm.ingested_at), { addSuffix: true })}</span>
        <span>
          {fm.message_count} mensagem(ns)
          {fm.chatter_filtered > 0 ? ` · ${fm.chatter_filtered} filtrada(s)` : ""}
        </span>
        <span>conta: {fm.account}</span>
      </div>
      {fm.triage?.reason && (
        <p className="text-xs text-text-secondary flex items-center gap-1.5">
          <AlertCircle size={12} className="text-text-muted" />
          {fm.triage.reason}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {fm.participants.map((p) => (
          <span
            key={`${p.handle}-${p.name}`}
            className="text-xs bg-bg border border-border rounded px-2 py-0.5 text-text-secondary"
            title={p.role}
          >
            {p.name || p.handle}
            {p.handle && p.name !== p.handle ? ` <${p.handle}>` : ""}
          </span>
        ))}
      </div>
      {(fm.compiled_into?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-muted">compilado em:</span>
          {fm.compiled_into!.map((path) => (
            <button
              key={path}
              onClick={() => {
                if (path.startsWith("wiki/")) {
                  navigate(`/second-brain/wiki/${path.replace(/^wiki\//, "").replace(/\.md$/, "")}`);
                } else {
                  navigate("/second-brain/state");
                }
              }}
              className="text-accent hover:underline"
            >
              {path}
            </button>
          ))}
        </div>
      )}
      {fm.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-text-muted">
          {fm.attachments.map((a) => (
            <span key={a.sha256} className="flex items-center gap-1" title={a.uri}>
              <Paperclip size={12} />
              {a.name} · {humanBytes(a.bytes)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
