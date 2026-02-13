import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, File, Folder, Save, SaveAll } from "lucide-react";
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
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
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

  const saveFile = useCallback(async (path: string) => {
    const buf = openFiles.get(path);
    if (!buf || buf.current === buf.original) return;

    try {
      await api.put(`/files?base=${base}&path=${encodeURIComponent(path)}`, { content: buf.current });
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.set(path, { original: buf.current, current: buf.current });
        return next;
      });
      return true;
    } catch {
      addToast("error", `Failed to save ${path.split("/").pop()}`);
      return false;
    }
  }, [openFiles, base, addToast]);

  const handleSave = useCallback(async () => {
    if (savingRef.current || !activeTab) return;
    savingRef.current = true;
    const ok = await saveFile(activeTab);
    if (ok) addToast("success", `Saved ${activeTab.split("/").pop()}`);
    savingRef.current = false;
  }, [activeTab, saveFile, addToast]);

  const handleSaveAll = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const dirtyFiles = Array.from(openFiles.entries())
      .filter(([, buf]) => buf.current !== buf.original)
      .map(([path]) => path);

    if (dirtyFiles.length === 0) {
      addToast("info", "No unsaved changes");
      savingRef.current = false;
      return;
    }

    let saved = 0;
    for (const path of dirtyFiles) {
      const ok = await saveFile(path);
      if (ok) saved++;
    }
    addToast("success", `Saved ${saved} file${saved > 1 ? "s" : ""}`);
    savingRef.current = false;
  }, [openFiles, saveFile, addToast]);

  const forceCloseTab = useCallback((path: string) => {
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

  const closeTab = useCallback((path: string) => {
    const buf = openFiles.get(path);
    if (buf && buf.current !== buf.original) {
      setConfirmClose(path);
      return;
    }
    forceCloseTab(path);
  }, [openFiles, forceCloseTab]);

  const handleConfirmSaveAndClose = useCallback(async () => {
    if (!confirmClose) return;
    const path = confirmClose;
    setConfirmClose(null);
    await saveFile(path);
    forceCloseTab(path);
    addToast("success", `Saved and closed ${path.split("/").pop()}`);
  }, [confirmClose, saveFile, forceCloseTab, addToast]);

  const handleConfirmDiscard = useCallback(() => {
    if (!confirmClose) return;
    forceCloseTab(confirmClose);
    setConfirmClose(null);
  }, [confirmClose, forceCloseTab]);

  const tabs: OpenFile[] = Array.from(openFiles.entries()).map(([path, buf]) => ({
    path,
    dirty: buf.current !== buf.original,
  }));

  const hasDirtyFiles = tabs.some((t) => t.dirty);
  const activeBuffer = activeTab ? openFiles.get(activeTab) : undefined;
  const activeIsDirty = activeBuffer ? activeBuffer.current !== activeBuffer.original : false;

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
    <div className="flex border border-border rounded-lg overflow-hidden h-full relative">
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
        <div className="flex items-center border-b border-border shrink-0">
          <div className="flex-1 overflow-x-auto">
            <EditorTabs
              tabs={tabs}
              activeTab={activeTab}
              onSelect={setActiveTab}
              onClose={closeTab}
            />
          </div>
          {tabs.length > 0 && (
            <div className="flex items-center gap-1 px-2 shrink-0 border-l border-border">
              <button
                onClick={handleSave}
                disabled={!activeIsDirty}
                title="Save (Ctrl+S)"
                className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <Save size={14} />
              </button>
              <button
                onClick={handleSaveAll}
                disabled={!hasDirtyFiles}
                title="Save All"
                className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <SaveAll size={14} />
              </button>
            </div>
          )}
        </div>
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

      {confirmClose && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-lg p-4 shadow-xl max-w-sm mx-4">
            <p className="text-sm text-text-primary mb-1 font-medium">Unsaved changes</p>
            <p className="text-xs text-text-muted mb-4">
              <span className="font-mono">{confirmClose.split("/").pop()}</span> has unsaved changes. Save before closing?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmClose(null)}
                className="px-3 py-1.5 text-xs rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDiscard}
                className="px-3 py-1.5 text-xs rounded-md bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleConfirmSaveAndClose}
                className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
