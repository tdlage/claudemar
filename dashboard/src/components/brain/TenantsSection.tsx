import { useState } from "react";
import { Merge, Pencil } from "lucide-react";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { api } from "../../lib/api";
import { useBrainData } from "../../hooks/useBrain";
import type { BrainTenantEntry } from "../../lib/types";

interface TreeNode {
  entry: BrainTenantEntry;
  children: TreeNode[];
}

function buildTree(entries: BrainTenantEntry[]): TreeNode[] {
  const active = entries.filter((e) => !e.merged_into);
  const byId = new Map(active.map((e) => [e.id, { entry: e, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.entry.parent ? byId.get(node.entry.parent) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortTree = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => a.entry.label.localeCompare(b.entry.label, "pt"))
      .map((n) => ({ ...n, children: sortTree(n.children) }));
  return sortTree(roots);
}

function flatten(nodes: TreeNode[], depth = 0): { entry: BrainTenantEntry; depth: number }[] {
  return nodes.flatMap((n) => [{ entry: n.entry, depth }, ...flatten(n.children, depth + 1)]);
}

export function TenantsSection() {
  const { data, loading, error, refresh } = useBrainData<BrainTenantEntry[]>("/brain/tenants");
  const { addToast } = useToast();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const entries = data ?? [];
  const rows = flatten(buildTree(entries));
  const merged = entries.filter((e) => e.merged_into);

  const merge = async () => {
    if (!source || !target || source === target) return;
    setBusy(true);
    try {
      const result = await api.post<{ rawThreads: number; wikiPages: number }>("/brain/tenants/merge", {
        source,
        target,
      });
      addToast(
        "success",
        `Contextos unificados — ${result.rawThreads} thread(s) e ${result.wikiPages} página(s) reapontadas`,
      );
      setSource("");
      setTarget("");
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string) => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/brain/tenants/${id}`, { label: label.trim() });
      addToast("success", "Contexto renomeado");
      setRenaming(null);
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reparent = async (id: string, parent: string) => {
    setBusy(true);
    try {
      await api.patch(`/brain/tenants/${id}`, { parent: parent || null });
      addToast("success", "Hierarquia atualizada");
      refresh();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-text-muted py-4">Carregando…</p>;
  if (error) return <p className="text-sm text-danger py-4">{error}</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Os contextos são inferidos pela triagem a partir do assunto, domínio e participantes — não há lista para
        preencher. A separação é deliberadamente generosa: aqui você só unifica o que ficou dividido demais.
      </p>

      <div className="border border-border rounded-md divide-y divide-border/60">
        {rows.map(({ entry, depth }) => (
          <div key={entry.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <div className="flex-1 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
              {renaming === entry.id ? (
                <div className="flex items-center gap-2">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => rename(entry.id)} disabled={busy}>
                    Salvar
                  </Button>
                  <button className="text-xs text-text-muted hover:underline" onClick={() => setRenaming(null)}>
                    cancelar
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-text-primary">{entry.label}</span>
                  <span className="ml-2 font-mono text-xs text-text-muted">{entry.id}</span>
                </>
              )}
              <p className="text-xs text-text-muted truncate">
                {entry.threads} thread(s)
                {entry.domains.length > 0 ? ` · ${entry.domains.join(", ")}` : ""}
                {entry.identifiers.length > 0 ? ` · ${entry.identifiers.join(", ")}` : ""}
              </p>
            </div>
            <select
              value={entry.parent ?? ""}
              onChange={(e) => reparent(entry.id, e.target.value)}
              disabled={busy}
              className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-accent"
            >
              <option value="">— raiz —</option>
              {rows
                .filter((r) => r.entry.id !== entry.id)
                .map((r) => (
                  <option key={r.entry.id} value={r.entry.id}>
                    {r.entry.label}
                  </option>
                ))}
            </select>
            <button
              onClick={() => {
                setRenaming(entry.id);
                setLabel(entry.label);
              }}
              className="text-text-muted hover:text-accent transition-colors"
              title="Renomear"
            >
              <Pencil size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="bg-bg border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Merge size={14} className="text-text-muted" />
          <span className="text-sm font-medium text-text-primary">Unificar contextos</span>
        </div>
        <p className="text-xs text-text-muted">
          O contexto de origem deixa de existir: threads, páginas e o índice passam a apontar para o destino.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">origem…</option>
            {rows.map((r) => (
              <option key={r.entry.id} value={r.entry.id}>
                {r.entry.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-text-muted">→</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">destino…</option>
            {rows
              .filter((r) => r.entry.id !== source)
              .map((r) => (
                <option key={r.entry.id} value={r.entry.id}>
                  {r.entry.label}
                </option>
              ))}
          </select>
          <Button size="sm" onClick={merge} disabled={busy || !source || !target || source === target}>
            Unificar
          </Button>
        </div>
      </div>

      {merged.length > 0 && (
        <p className="text-xs text-text-muted">
          Já unificados: {merged.map((e) => `${e.label} → ${e.merged_into}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
