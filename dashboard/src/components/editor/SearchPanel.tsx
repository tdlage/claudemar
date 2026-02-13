import { useState, useCallback, useRef, useEffect } from "react";
import { FileText, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";
import type { SearchResponse, SearchMatch } from "../../lib/types";

interface SearchPanelProps {
  base: string;
  onResultClick: (path: string, line: number) => void;
}

export function SearchPanel({ base, onResultClick }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Record<string, SearchMatch[]>>({});
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults({});
        setCount(0);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          base,
          query: q,
          caseSensitive: String(caseSensitive),
          regex: String(useRegex),
          wholeWord: String(wholeWord),
        });
        const response = await api.get<SearchResponse>(`/files/search?${params}`);
        setResults(response.results);
        setCount(response.count);
      } catch {
        setResults({});
        setCount(0);
      } finally {
        setLoading(false);
      }
    },
    [base, caseSensitive, useRegex, wholeWord],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 400);
    },
    [doSearch],
  );

  const toggleFile = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleToggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
      setter((v) => !v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(query), 200);
    },
    [doSearch, query],
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
            onClick={() => handleToggle(setCaseSensitive)}
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
            onClick={() => handleToggle(setWholeWord)}
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
            onClick={() => handleToggle(setUseRegex)}
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
