import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { EditorTabs, type OpenFile } from "../editor/EditorTabs";
import { MonacoEditorWrapper, detectLanguage } from "../editor/MonacoEditor";
import type { FileEntry, FileReadResult } from "../../lib/types";

interface FilesBrowserProps {
  projectName: string;
}

interface FileBuffer {
  original: string;
  current: string;
}

export function FilesBrowser({ projectName }: FilesBrowserProps) {
  const { addToast } = useToast();
  const base = `project:${projectName}`;
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});
  const [openFiles, setOpenFiles] = useState<Map<string, FileBuffer>>(new Map());
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const loadDir = useCallback(async (path: string) => {
    try {
      const result = await api.get<FileReadResult>(`/files?base=${base}&path=${encodeURIComponent(path)}`);
      if (result.type === "directory" && result.entries) {
        if (path === "") {
          setTree(result.entries);
          setError(null);
        } else {
          setDirContents((prev) => ({ ...prev, [path]: result.entries! }));
        }
      }
    } catch (err) {
      if (path === "") {
        setError(err instanceof Error ? err.message : "Failed to load files");
      } else {
        addToast("error", "Failed to load directory");
      }
    }
  }, [base, addToast]);

  useEffect(() => {
    setTree([]);
    setExpandedDirs(new Set());
    setDirContents({});
    setOpenFiles(new Map());
    setActiveTab(null);
    setError(null);
    loadDir("");
  }, [loadDir]);

  const toggleDir = (path: string) => {
    const next = new Set(expandedDirs);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!dirContents[path]) loadDir(path);
    }
    setExpandedDirs(next);
  };

  const downloadFile = async (path: string) => {
    try {
      const token = localStorage.getItem("dashboard_token") || "";
      const res = await fetch(`/api/files/download?base=${base}&path=${encodeURIComponent(path)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      addToast("error", "Failed to download file");
    }
  };

  const openFile = async (path: string) => {
    if (openFiles.has(path)) {
      setActiveTab(path);
      return;
    }

    setLoading(true);
    try {
      const result = await api.get<FileReadResult>(`/files?base=${base}&path=${encodeURIComponent(path)}`);
      if (result.type === "file") {
        if (result.binary) {
          downloadFile(path);
          setLoading(false);
          return;
        }
        const content = result.content || "";
        setOpenFiles((prev) => new Map(prev).set(path, { original: content, current: content }));
        setActiveTab(path);
      }
    } catch {
      addToast("error", "Failed to load file");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = useCallback((value: string) => {
    setActiveTab((tab) => {
      if (!tab) return tab;
      setOpenFiles((prev) => {
        const next = new Map(prev);
        const existing = next.get(tab);
        if (existing) {
          next.set(tab, { ...existing, current: value });
        }
        return next;
      });
      return tab;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    const tab = activeTab;
    if (!tab) return;
    const buf = openFiles.get(tab);
    if (!buf || buf.current === buf.original) return;

    savingRef.current = true;
    try {
      await api.put(`/files?base=${base}&path=${encodeURIComponent(tab)}`, { content: buf.current });
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.set(tab, { original: buf.current, current: buf.current });
        return next;
      });
      addToast("success", `Saved ${tab.split("/").pop()}`);
    } catch {
      addToast("error", "Failed to save file");
    } finally {
      savingRef.current = false;
    }
  }, [activeTab, openFiles, base, addToast]);

  const closeTab = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
    setActiveTab((current) => {
      if (current !== path) return current;
      const keys = Array.from(openFiles.keys()).filter((k) => k !== path);
      return keys.length > 0 ? keys[keys.length - 1] : null;
    });
  }, [openFiles]);

  const tabs: OpenFile[] = Array.from(openFiles.entries()).map(([path, buf]) => ({
    path,
    dirty: buf.current !== buf.original,
  }));

  const activeBuffer = activeTab ? openFiles.get(activeTab) : undefined;

  function renderEntries(entries: FileEntry[], depth = 0) {
    return entries
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => (
        <div key={entry.path}>
          <button
            onClick={() => entry.type === "directory" ? toggleDir(entry.path) : openFile(entry.path)}
            className={`flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-surface-hover rounded text-left ${
              activeTab === entry.path ? "bg-accent/10 text-accent" : "text-text-secondary"
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {entry.type === "directory" ? (
              <>
                <ChevronRight
                  size={12}
                  className={`transition-transform ${expandedDirs.has(entry.path) ? "rotate-90" : ""}`}
                />
                <Folder size={14} />
              </>
            ) : (
              <>
                <span className="w-3" />
                <File size={14} />
              </>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {entry.type === "directory" && expandedDirs.has(entry.path) && dirContents[entry.path] && (
            renderEntries(dirContents[entry.path], depth + 1)
          )}
        </div>
      ));
  }

  return (
    <div className="flex border border-border rounded-lg overflow-hidden" style={{ height: "600px" }}>
      <div className="w-64 bg-surface border-r border-border overflow-y-auto p-1 shrink-0">
        {error ? (
          <p className="text-xs text-danger p-2">{error}</p>
        ) : tree.length === 0 ? (
          <p className="text-xs text-text-muted p-2">No files found.</p>
        ) : (
          renderEntries(tree)
        )}
      </div>

      <div className="flex-1 flex flex-col bg-bg min-w-0">
        <EditorTabs
          tabs={tabs}
          activeTab={activeTab}
          onSelect={setActiveTab}
          onClose={closeTab}
        />
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            Loading...
          </div>
        ) : activeBuffer ? (
          <div className="flex-1 min-h-0">
            <MonacoEditorWrapper
              key={activeTab}
              content={activeBuffer.current}
              onChange={handleChange}
              language={detectLanguage(activeTab!)}
              onSave={handleSave}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}
