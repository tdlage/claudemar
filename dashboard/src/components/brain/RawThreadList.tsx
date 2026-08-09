import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "../shared/Badge";
import { useDebounce } from "../../hooks/useDebounce";
import { useBrainData } from "../../hooks/useBrain";
import type { GoogleAccountStatus, RawThreadListItem } from "../../lib/types";

const PAGE_SIZE = 25;

const RELEVANCE_META: Record<number, { label: string; variant: "default" | "info" | "accent" | "warning" }> = {
  0: { label: "ruído", variant: "default" },
  1: { label: "transacional", variant: "info" },
  2: { label: "relevante", variant: "accent" },
  3: { label: "crítico", variant: "warning" },
};

export function RawThreadList({ channel }: { channel: string }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [relevance, setRelevance] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const query = useMemo(() => {
    const params = new URLSearchParams({ channel, page: String(page), pageSize: String(PAGE_SIZE) });
    if (month) params.set("month", month);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (relevance) params.set("relevance", relevance);
    if (account) params.set("account", account);
    return `/brain/raw/threads?${params.toString()}`;
  }, [channel, month, debouncedSearch, relevance, account, page]);

  const { data, loading, error } = useBrainData<{
    items: RawThreadListItem[];
    total: number;
    truncated?: boolean;
  }>(query);
  const { data: accounts } = useBrainData<GoogleAccountStatus[]>("/brain/google/accounts");

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const inputClass =
    "bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate("/second-brain/raw")}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Voltar"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-medium text-text-primary capitalize">{channel}</span>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar assunto ou participante…"
            className={`${inputClass} pl-8 w-64`}
          />
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setPage(1);
          }}
          className={inputClass}
        />
        <select
          value={relevance}
          onChange={(e) => {
            setRelevance(e.target.value);
            setPage(1);
          }}
          className={inputClass}
        >
          <option value="">relevância: todas</option>
          <option value="0">0 · ruído</option>
          <option value="1">1 · transacional</option>
          <option value="2">2 · relevante</option>
          <option value="3">3 · crítico</option>
        </select>
        {(accounts?.length ?? 0) > 1 && (
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="">conta: todas</option>
            {accounts!.map((a) => (
              <option key={a.email} value={a.email}>
                {a.email}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && <p className="text-sm text-text-muted py-8 text-center">Carregando…</p>}
      {error && <p className="text-sm text-danger py-8 text-center">{error}</p>}
      {!loading && !error && (data?.items.length ?? 0) === 0 && (
        <p className="text-sm text-text-muted py-8 text-center">Nenhuma thread encontrada com esses filtros.</p>
      )}
      {data?.truncated && (
        <p className="text-xs text-warning">
          Busca interrompida ao atingir o limite de resultados — refine os filtros ou escolha um mês.
        </p>
      )}

      <div className="space-y-1.5">
        {data?.items.map((item) => {
          const fm = item.frontmatter;
          const rel = fm.triage ? RELEVANCE_META[fm.triage.relevance] : null;
          const others = fm.participants.filter((p) => p.handle.toLowerCase() !== fm.account.toLowerCase());
          return (
            <button
              key={item.path}
              onClick={() => navigate(`/second-brain/raw/${item.path.replace(/^raw\//, "").replace(/\.md$/, "")}`)}
              className="w-full text-left bg-surface border border-border rounded-lg px-4 py-2.5 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary truncate flex-1">{fm.subject || "(sem assunto)"}</span>
                {rel && <Badge variant={rel.variant}>{rel.label}</Badge>}
                {fm.subchannel === "group" && <Badge>grupo</Badge>}
                <span className="text-xs text-text-muted shrink-0">
                  {fm.occurred_to ? format(new Date(fm.occurred_to), "dd/MM/yyyy") : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted">
                <span className="truncate flex-1">
                  {others.slice(0, 3).map((p) => p.name || p.handle).join(", ") || fm.account}
                </span>
                <span className="shrink-0">{fm.account}</span>
                <span className="shrink-0">
                  {fm.message_count} msg{fm.chatter_filtered > 0 ? ` · ${fm.chatter_filtered} chatter` : ""}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="p-1.5 rounded text-text-muted hover:bg-surface-hover disabled:opacity-40 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-text-muted text-xs">
            {page} / {totalPages} · {data?.total ?? 0} threads
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="p-1.5 rounded text-text-muted hover:bg-surface-hover disabled:opacity-40 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
