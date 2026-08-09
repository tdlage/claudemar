import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { api } from "../../lib/api";
import { useBrainData } from "../../hooks/useBrain";
import type { BrainOpenLoop } from "../../lib/types";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isOverdue(due: string, status: BrainOpenLoop["status"]): boolean {
  if (status !== "open") return false;
  if (DATE_ONLY_RE.test(due)) return due < todayKey();
  const parsed = new Date(due);
  return !Number.isNaN(parsed.getTime()) && parsed < new Date();
}

function formatDue(due: string): string {
  if (DATE_ONLY_RE.test(due)) {
    const [y, m, d] = due.split("-");
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(due);
  return Number.isNaN(parsed.getTime()) ? due : format(parsed, "dd/MM/yyyy");
}

const KIND_LABELS: Record<BrainOpenLoop["kind"], string> = {
  my_commitment: "compromisso meu",
  waiting_on: "esperando terceiro",
  decision_pending: "decisão pendente",
};

export function OpenLoopsTable() {
  const { data, loading, refresh } = useBrainData<BrainOpenLoop[]>("/brain/state/open-loops");
  const { addToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const transition = async (loop: BrainOpenLoop, action: "close" | "reopen") => {
    setBusyId(loop.id);
    try {
      await api.post(`/brain/open-loops/${loop.id}/${action}`, {});
      addToast("success", action === "close" ? "Pendência concluída" : "Pendência reaberta");
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="text-sm text-text-muted py-4 text-center">Carregando…</p>;
  const loops = data ?? [];
  if (loops.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4 text-center">
        Nenhum open-loop registrado — o compilador cria pendências a partir de compromissos e prazos detectados.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted border-b border-border">
            <th className="py-2 pr-3 font-medium">Título</th>
            <th className="py-2 pr-3 font-medium">Tipo</th>
            <th className="py-2 pr-3 font-medium">Contraparte</th>
            <th className="py-2 pr-3 font-medium">Prazo</th>
            <th className="py-2 pr-3 font-medium">Situação</th>
            <th className="py-2 pr-3 font-medium">Próxima ação</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {loops.map((loop) => (
            <tr key={loop.id} className="border-b border-border/50">
              <td className="py-2 pr-3 text-text-primary">{loop.title}</td>
              <td className="py-2 pr-3 text-text-muted text-xs">{KIND_LABELS[loop.kind]}</td>
              <td className="py-2 pr-3 text-text-secondary">{loop.counterparty}</td>
              <td className="py-2 pr-3 text-xs">
                {loop.due ? (
                  <span className={isOverdue(loop.due, loop.status) ? "text-danger" : "text-text-secondary"}>
                    {formatDue(loop.due)}
                  </span>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <Badge variant={loop.status === "open" ? "warning" : loop.status === "done" ? "success" : "default"}>
                  {loop.status}
                </Badge>
              </td>
              <td className="py-2 pr-3 text-text-secondary text-xs">{loop.next_action}</td>
              <td className="py-2 text-right">
                {loop.status === "open" ? (
                  <Button size="sm" variant="ghost" disabled={busyId === loop.id} onClick={() => transition(loop, "close")}>
                    Concluir
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busyId === loop.id} onClick={() => transition(loop, "reopen")}>
                    Reabrir
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
