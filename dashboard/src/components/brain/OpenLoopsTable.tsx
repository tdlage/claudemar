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

const STATUS_LABELS: Record<BrainOpenLoop["status"], string> = {
  open: "aberta",
  done: "concluída",
  abandoned: "ignorada",
  superseded: "substituída",
};

type LoopFilter = "open" | "done" | "abandoned";
type LoopAction = "close" | "ignore" | "reopen";

const FILTERS: { key: LoopFilter; label: string; empty: string }[] = [
  { key: "open", label: "Abertas", empty: "Nenhuma pendência em aberto." },
  { key: "done", label: "Concluídas", empty: "Nenhuma pendência concluída." },
  { key: "abandoned", label: "Ignoradas", empty: "Nenhuma pendência ignorada." },
];

const ACTION_TOASTS: Record<LoopAction, (count: number) => string> = {
  close: (n) => (n === 1 ? "Pendência concluída" : `${n} pendências concluídas`),
  ignore: (n) => (n === 1 ? "Pendência ignorada" : `${n} pendências ignoradas`),
  reopen: (n) => (n === 1 ? "Pendência reaberta" : `${n} pendências reabertas`),
};

export function OpenLoopsTable() {
  const { data, loading, refresh } = useBrainData<BrainOpenLoop[]>("/brain/state/open-loops");
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<LoopFilter>("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const apply = async (ids: string[], action: LoopAction) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const { updated } = await api.post<{ updated: number }>("/brain/open-loops/bulk", { ids, action });
      addToast("success", ACTION_TOASTS[action](updated));
      setSelected(new Set());
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-text-muted py-4 text-center">Carregando…</p>;
  const all = data ?? [];
  if (all.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4 text-center">
        Nenhum open-loop registrado — o compilador cria pendências a partir de compromissos e prazos detectados.
      </p>
    );
  }

  const counts: Record<LoopFilter, number> = {
    open: all.filter((l) => l.status === "open").length,
    done: all.filter((l) => l.status === "done").length,
    abandoned: all.filter((l) => l.status === "abandoned").length,
  };
  const loops = all.filter((l) => l.status === filter);
  const visibleSelected = loops.filter((l) => selected.has(l.id)).map((l) => l.id);
  const allSelected = loops.length > 0 && visibleSelected.length === loops.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const changeFilter = (key: LoopFilter) => {
    setFilter(key);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Situação das pendências">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => changeFilter(f.key)}
              className={`px-2.5 py-1 rounded-md text-xs border cursor-pointer ${filter === f.key ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted hover:text-text-primary"}`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
        {visibleSelected.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-text-muted mr-1">{visibleSelected.length} selecionada(s)</span>
            {filter === "open" ? (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => apply(visibleSelected, "close")}>Concluir</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => apply(visibleSelected, "ignore")}>Ignorar</Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => apply(visibleSelected, "reopen")}>Reabrir</Button>
            )}
          </div>
        )}
      </div>

      {loops.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">{FILTERS.find((f) => f.key === filter)?.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="py-2 pr-2 w-6">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(loops.map((l) => l.id)))}
                  />
                </th>
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
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Selecionar ${loop.title}`} checked={selected.has(loop.id)} onChange={() => toggle(loop.id)} />
                  </td>
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
                      {STATUS_LABELS[loop.status]}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-text-secondary text-xs">{loop.next_action}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {loop.status === "open" ? (
                      <>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply([loop.id], "close")}>
                          Concluir
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply([loop.id], "ignore")}>
                          Ignorar
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => apply([loop.id], "reopen")}>
                        Reabrir
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
