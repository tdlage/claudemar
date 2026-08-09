import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { MarkdownViewer } from "../shared/MarkdownViewer";
import { WikiPageHeader } from "./WikiPageHeader";
import { WikiHistoryPanel } from "./WikiHistoryPanel";
import type { WikiPage } from "../../lib/types";

export function WikiPageView({
  path,
  landing = false,
  onNavigate,
}: {
  path: string;
  landing?: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingRef, setViewingRef] = useState<string | null>(null);

  const load = useCallback(
    (ref?: string) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ path });
      if (ref) params.set("ref", ref);
      api
        .get<WikiPage>(`/brain/wiki/page?${params.toString()}`)
        .then((p) => {
          setPage(p);
          setViewingRef(ref ?? null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [path],
  );

  useEffect(() => {
    setShowHistory(false);
    load();
  }, [load]);

  const handleClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("http") || href.startsWith("#")) return;
    e.preventDefault();
    const clean = href.replace(/^\.\.?\//, "").replace(/\.md$/, "");
    if (clean.startsWith("raw/")) navigate(`/second-brain/raw/${clean.replace(/^raw\//, "")}`);
    else navigate(`/second-brain/wiki/${clean.replace(/^wiki\//, "")}`);
    onNavigate?.();
  };

  if (loading && !page) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;

  if (error || !page) {
    if (landing) {
      return (
        <p className="text-sm text-text-muted py-10 text-center">
          O índice (wiki/index.md) ainda não foi gerado pelo compilador. Selecione uma página na árvore.
        </p>
      );
    }
    return <p className="text-sm text-danger py-8 text-center">{error ?? "Página não encontrada"}</p>;
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <Card className="flex-1 min-w-0 space-y-4">
        {!landing && (
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <WikiPageHeader fm={page.frontmatter} path={page.path} onReviewed={() => load()} />
            </div>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`p-1.5 rounded transition-colors shrink-0 ${
                showHistory ? "text-accent bg-accent/10" : "text-text-muted hover:bg-surface-hover"
              }`}
              title="Histórico de versões"
            >
              <History size={15} />
            </button>
          </div>
        )}
        {viewingRef && (
          <div className="bg-warning/10 border border-warning/30 rounded-md px-3 py-2 text-xs text-warning flex items-center gap-3">
            Você está vendo a versão {viewingRef.slice(0, 8)}
            <button onClick={() => load()} className="underline hover:no-underline">
              Voltar para a atual
            </button>
          </div>
        )}
        <div onClick={handleClick}>
          <MarkdownViewer content={page.body} />
        </div>
      </Card>
      {showHistory && !landing && (
        <div className="lg:w-72 shrink-0">
          <WikiHistoryPanel path={path} activeRef={viewingRef} onSelect={(sha) => load(sha)} onCurrent={() => load()} />
        </div>
      )}
    </div>
  );
}
