import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import type { TrackerItemSearchResult } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: string[]) => void;
}

export function TrackerItemSelector({ open, onClose, onConfirm }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrackerItemSearchResult[]>([]);
  const [selected, setSelected] = useState<TrackerItemSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected([]);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get<TrackerItemSearchResult[]>(`/tracker/items/search?q=${encodeURIComponent(query.trim())}`);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const toggleItem = (item: TrackerItemSearchResult) => {
    setSelected((prev) =>
      prev.some((s) => s.id === item.id)
        ? prev.filter((s) => s.id !== item.id)
        : [...prev, item],
    );
  };

  const handleConfirm = () => {
    onConfirm(selected.map((s) => s.code));
  };

  return (
    <Modal open={open} onClose={onClose} title="Link Tracker Items">
      <div className="space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or title..."
            autoFocus
            className="w-full bg-bg border border-border rounded-md pl-9 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-accent/10 text-accent"
              >
                <span className="font-mono">{item.code}</span>
                <button onClick={() => toggleItem(item)} className="hover:text-accent-hover">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">
          {searching && (
            <div className="px-3 py-2 text-xs text-text-muted">Searching...</div>
          )}
          {!searching && query.trim() && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">No results found</div>
          )}
          {!searching && !query.trim() && (
            <div className="px-3 py-2 text-xs text-text-muted">Type to search tracker items</div>
          )}
          {results.map((item) => {
            const isSelected = selected.some((s) => s.id === item.id);
            return (
              <button
                key={item.id}
                onClick={() => toggleItem(item)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors flex items-center gap-2 ${
                  isSelected ? "bg-accent/5" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  className="rounded border-border text-accent focus:ring-accent shrink-0"
                />
                <span className="font-mono text-xs text-accent shrink-0">{item.code}</span>
                <span className="text-text-primary truncate">{item.title}</span>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Skip
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            {selected.length > 0 ? `Commit with ${selected.length} item${selected.length > 1 ? "s" : ""}` : "Commit without items"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
