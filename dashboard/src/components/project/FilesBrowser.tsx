import { useState, useEffect, useCallback } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import type { FileEntry, FileReadResult } from "../../lib/types";

interface FilesBrowserProps {
  projectName: string;
}

export function FilesBrowser({ projectName }: FilesBrowserProps) {
  const { addToast } = useToast();
  const base = `project:${projectName}`;
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});
  const [currentFile, setCurrentFile] = useState<string>("");
  const [fileContent, setFileContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setCurrentFile("");
    setFileContent("");
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

  const openFile = async (path: string) => {
    setLoading(true);
    try {
      const result = await api.get<FileReadResult>(`/files?base=${base}&path=${encodeURIComponent(path)}`);
      if (result.type === "file") {
        setCurrentFile(path);
        setFileContent(result.binary ? "(binary file)" : result.content || "");
      }
    } catch {
      setFileContent("Failed to load file");
    } finally {
      setLoading(false);
    }
  };

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
              currentFile === entry.path ? "bg-accent/10 text-accent" : "text-text-secondary"
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
    <div className="flex border border-border rounded-lg overflow-hidden" style={{ height: "500px" }}>
      <div className="w-72 bg-surface border-r border-border overflow-y-auto p-1">
        {error ? (
          <p className="text-xs text-danger p-2">{error}</p>
        ) : tree.length === 0 ? (
          <p className="text-xs text-text-muted p-2">No files found.</p>
        ) : (
          renderEntries(tree)
        )}
      </div>

      <div className="flex-1 flex flex-col bg-bg">
        {currentFile ? (
          <>
            <div className="px-4 py-2 border-b border-border bg-surface text-sm text-text-muted">
              {currentFile}
            </div>
            {loading ? (
              <p className="p-4 text-sm text-text-muted">Loading...</p>
            ) : (
              <pre className="flex-1 p-4 text-sm text-text-primary font-mono whitespace-pre-wrap overflow-auto">
                {fileContent}
              </pre>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
