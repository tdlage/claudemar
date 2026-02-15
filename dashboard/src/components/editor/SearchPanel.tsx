import { useState, useCallback, useRef, useEffect } from "react";
import { FileText, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";
import type { SearchResponse } from "../../lib/types";
import type { SearchState } from "../project/FilesBrowser";

interface SearchPanelProps {
  base: string;
  onResultClick: (path: string, line: number) => void;
  state: SearchState;
  onStateChange: (state: SearchState) => void;
}

export function SearchPanel({ base, onResultClick, state, onStateChange }: SearchPanelProps) {
  const { query, results, count, caseSensitive, useRegex, wholeWord, collapsedFiles } = state;
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback((partial: Partial<SearchState>) => {
    onStateChange({ ...stateRef.current, ...partial });
  }, [onStateChange]);

  const doSearch = useCallback(
    async (q: string, overrides?: Partial<SearchState>) => {
      const s = { ...stateRef.current, ...overrides };
      if (!q.trim()) {
        update({ query: q, results: {}, count: 0 });
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          base,
          query: q,
          caseSensitive: String(s.caseSensitive),
          regex: String(s.useRegex),
          wholeWord: String(s.wholeWord),
        });
        const response = await api.get<SearchResponse>(`/files/search?${params}`);
        update({ query: q, results: response.results, count: response.count, ...overrides });
      } catch {
        update({ query: q, results: {}, count: 0, ...overrides });
      } finally {
        setLoading(false);
      }
    },
    [base, update],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
      update({ query: value });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 400);
    },
    [doSearch, update],
  );

  const toggleFile = useCallback((path: string) => {
    const next = new Set(stateRef.current.collapsedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    update({ collapsedFiles: next });
  }, [update]);

  const handleToggle = useCallback(
    (key: "caseSensitive" | "useRegex" | "wholeWord") => {
      const newVal = !stateRef.current[key];
      const overrides = { [key]: newVal };
      update(overrides);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(stateRef.current.query, overrides), 200);
    },
    [doSearch, update],
  );

  const fileCount = Object.keys(results).length;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border space-y-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doSearch(query);
          }}
          placeholder="Search"
          className="w-full bg-bg border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleToggle("caseSensitive")}
            className={`px-1.5 py-0.5 text-[10px] font-mono border rounded transition-colors ${
              caseSensitive
                ? "bg-accent/20 border-accent text-accent"
                : "border-border text-text-muted hover:text-text-secondary"
            }`}
            title="Match Case"
          >
            Aa
          </button>
          <button
            onClick={() => handleToggle("wholeWord")}
            className={`px-1.5 py-0.5 text-[10px] font-mono border rounded transition-colors ${
              wholeWord
                ? "bg-accent/20 border-accent text-accent"
                : "border-border text-text-muted hover:text-text-secondary"
            }`}
            title="Match Whole Word"
          >
            ab
          </button>
          <button
            onClick={() => handleToggle("useRegex")}
            className={`px-1.5 py-0.5 text-[10px] font-mono border rounded transition-colors ${
              useRegex
                ? "bg-accent/20 border-accent text-accent"
                : "border-border text-text-muted hover:text-text-secondary"
            }`}
            title="Use Regular Expression"
          >
            .*
          </button>
        </div>
        {count > 0 && (
          <p className="text-[11px] text-text-muted">
            {count} results in {fileCount} file{fileCount !== 1 ? "s" : ""}
          </p>
        )}
        {loading && (
          <p className="text-[11px] text-text-muted animate-pulse">Searching...</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {Object.entries(results).map(([path, matches]) => {
          const isCollapsed = collapsedFiles.has(path);
          return (
            <div key={path}>
              <button
                onClick={() => toggleFile(path)}
                className="w-full flex items-center gap-1 px-2 py-1 text-xs bg-surface hover:bg-surface-hover transition-colors"
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <FileText size={12} className="text-text-muted shrink-0" />
                <span className="truncate text-text-primary font-medium">{path}</span>
                <span className="text-text-muted ml-auto shrink-0">{matches.length}</span>
              </button>
              {!isCollapsed &&
                matches.map((match, idx) => (
                  <button
                    key={idx}
                    onClick={() => onResultClick(path, match.line)}
                    className="w-full text-left pl-7 pr-2 py-0.5 text-xs hover:bg-surface-hover transition-colors flex items-baseline gap-2 group"
                  >
                    <span className="text-text-muted shrink-0 w-8 text-right tabular-nums">
                      {match.line}
                    </span>
                    <span className="text-text-secondary truncate group-hover:text-text-primary">
                      {match.content}
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
        {!loading && count === 0 && query.trim() && (
          <p className="text-xs text-text-muted text-center py-6">No results found</p>
        )}
      </div>
    </div>
  );
}
