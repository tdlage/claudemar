import { useNavigate } from "react-router-dom";
import { useBrainData } from "../../hooks/useBrain";
import { WikiTree } from "./WikiTree";
import { WikiPageView } from "./WikiPageView";
import type { WikiTreeSection } from "../../lib/types";

export function WikiTab({ splat }: { splat: string }) {
  const navigate = useNavigate();
  const { data: tree, loading, refresh } = useBrainData<WikiTreeSection[]>("/brain/wiki/tree");

  const totalPages = tree?.reduce((acc, s) => acc + s.pages.length, 0) ?? 0;
  const activePath = splat ? `wiki/${splat}${splat.endsWith(".md") ? "" : ".md"}` : "";

  if (loading && !tree) return <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>;

  if (totalPages === 0 && !splat) {
    return (
      <p className="text-sm text-text-muted py-10 text-center max-w-md mx-auto">
        O wiki é construído pelo compilador a partir das ingestões. Ligue a triagem e a compilação em
        Configurações — ou rode um backfill — para populá-lo.
      </p>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className="md:w-60 shrink-0">
        <WikiTree
          sections={tree ?? []}
          activePath={activePath}
          onSelect={(path) => navigate(`/second-brain/wiki/${path.replace(/^wiki\//, "").replace(/\.md$/, "")}`)}
        />
      </div>
      <div className="flex-1 min-w-0">
        {activePath ? (
          <WikiPageView path={activePath} onNavigate={refresh} />
        ) : (
          <WikiPageView path="wiki/index.md" landing onNavigate={refresh} />
        )}
      </div>
    </div>
  );
}
