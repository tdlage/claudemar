import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Modal } from "../shared/Modal";
import { useMobile } from "../../hooks/useMobile";
import { useBrainData } from "../../hooks/useBrain";
import { WikiTree } from "./WikiTree";
import { WikiPageView } from "./WikiPageView";
import type { WikiTreeSection } from "../../lib/types";

export function WikiTab({ splat }: { splat: string }) {
  const navigate = useNavigate();
  const mobile = useMobile();
  const [indexOpen, setIndexOpen] = useState(false);
  const { data: tree, loading, refresh } = useBrainData<WikiTreeSection[]>("/brain/wiki/tree");

  const totalPages = tree?.reduce((acc, s) => acc + s.pages.length, 0) ?? 0;
  const activePath = splat ? `wiki/${splat}${splat.endsWith(".md") ? "" : ".md"}` : "";
  const index = <WikiTree sections={tree ?? []} activePath={activePath} onSelect={(path) => {
    navigate(`/second-brain/wiki/${path.replace(/^wiki\//, "").replace(/\.md$/, "")}`);
    setIndexOpen(false);
  }} />;

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
      {mobile ? <>
        <button onClick={() => setIndexOpen(true)} className="flex items-center gap-2 rounded-xl border border-border px-3 text-sm"><BookOpen size={18} />Índice do wiki · {totalPages} páginas</button>
        <Modal open={indexOpen} onClose={() => setIndexOpen(false)} title="Índice do wiki">{index}</Modal>
      </> : <div className="md:w-60 shrink-0">{index}</div>}
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
