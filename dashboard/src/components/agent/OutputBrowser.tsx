import { useState, useCallback, useEffect } from "react";
import { ArrowLeft, Download, FileText, Folder, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { useToast } from "../shared/Toast";

export interface OutputFile {
  name: string;
  type: "file" | "directory";
  size: number;
  mtime: string;
}

interface OutputBrowserProps {
  agentName: string;
  files: OutputFile[];
  onRefresh: () => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function OutputBrowser({ agentName, files, onRefresh }: OutputBrowserProps) {
  const { addToast } = useToast();
  const [currentPath, setCurrentPath] = useState("");
  const [subFiles, setSubFiles] = useState<OutputFile[] | null>(null);
  const [loading, setLoading] = useState(false);

  const displayFiles = currentPath ? subFiles ?? [] : files;

  const loadSubDir = useCallback((path: string) => {
    setLoading(true);
    api.get<OutputFile[]>(`/agents/${agentName}/output?path=${encodeURIComponent(path)}`)
      .then(setSubFiles)
      .catch(() => setSubFiles([]))
      .finally(() => setLoading(false));
  }, [agentName]);

  useEffect(() => {
    if (currentPath) loadSubDir(currentPath);
  }, [currentPath, loadSubDir]);

  useEffect(() => {
    if (!currentPath) setSubFiles(null);
  }, [files, currentPath]);

  const navigateInto = (dirName: string) => {
    setCurrentPath((prev) => (prev ? `${prev}/${dirName}` : dirName));
  };

  const navigateBack = () => {
    setCurrentPath((prev) => {
      const idx = prev.lastIndexOf("/");
      return idx === -1 ? "" : prev.substring(0, idx);
    });
  };

  const handleDownload = async (fileName: string, isDir: boolean) => {
    try {
      const token = localStorage.getItem("dashboard_token") || "";
      const entry = currentPath ? `${currentPath}/${fileName}` : fileName;
      const encodedPath = entry.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`/api/agents/${agentName}/output-dl/${encodedPath}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isDir ? `${fileName}.zip` : fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast("error", "Failed to download");
    }
  };

  const handleDelete = async (fileName: string) => {
    try {
      const entry = currentPath ? `${currentPath}/${fileName}` : fileName;
      const encodedPath = entry.split("/").map(encodeURIComponent).join("/");
      await api.delete(`/agents/${agentName}/output-rm/${encodedPath}`);
      if (currentPath) {
        loadSubDir(currentPath);
      }
      onRefresh();
      addToast("success", "Deleted");
    } catch {
      addToast("error", "Failed to delete");
    }
  };

  const pathParts = currentPath ? currentPath.split("/") : [];

  return (
    <div className="space-y-2">
      {currentPath && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <button
            onClick={navigateBack}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-text-muted">/</span>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              {i < pathParts.length - 1 ? (
                <button
                  onClick={() => setCurrentPath(pathParts.slice(0, i + 1).join("/"))}
                  className="hover:text-accent transition-colors cursor-pointer"
                >
                  {part}
                </button>
              ) : (
                <span className="text-text-primary font-medium">{part}</span>
              )}
              {i < pathParts.length - 1 && <span className="text-text-muted">/</span>}
            </span>
          ))}
        </div>
      )}

      {loading && <p className="text-sm text-text-muted">Loading...</p>}

      {!loading && displayFiles.length === 0 && (
        <p className="text-sm text-text-muted">
          {currentPath ? "Empty directory." : "No output files."}
        </p>
      )}

      {!loading && displayFiles.map((file) => (
        <Card key={file.name} className="px-4 py-3 flex items-center gap-2">
          {file.type === "directory" ? (
            <Folder size={14} className="text-accent shrink-0" />
          ) : (
            <FileText size={14} className="text-text-muted shrink-0" />
          )}
          {file.type === "directory" ? (
            <button
              onClick={() => navigateInto(file.name)}
              className="text-sm text-accent hover:underline truncate flex-1 text-left cursor-pointer"
            >
              {file.name}
            </button>
          ) : (
            <span className="text-sm text-text-primary truncate flex-1">{file.name}</span>
          )}
          {file.type === "file" && (
            <span className="text-xs text-text-muted whitespace-nowrap">
              {formatSize(file.size)}
            </span>
          )}
          <span className="text-xs text-text-muted whitespace-nowrap">
            {new Date(file.mtime).toLocaleString()}
          </span>
          <button
            onClick={() => handleDownload(file.name, file.type === "directory")}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-accent transition-colors cursor-pointer"
            title={file.type === "directory" ? "Download as ZIP" : "Download"}
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => handleDelete(file.name)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-red-400 transition-colors cursor-pointer"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </Card>
      ))}
    </div>
  );
}
