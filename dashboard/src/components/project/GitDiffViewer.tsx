import { useState, useEffect, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { api } from "../../lib/api";
import { detectLanguage } from "../editor/MonacoEditor";
import type { GitFileStatus, GitFileDiff } from "../../lib/types";

interface GitDiffViewerProps {
  projectName: string;
  repoName: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  M: { label: "M", color: "text-yellow-400 bg-yellow-400/15" },
  A: { label: "A", color: "text-green-400 bg-green-400/15" },
  D: { label: "D", color: "text-red-400 bg-red-400/15" },
  R: { label: "R", color: "text-blue-400 bg-blue-400/15" },
  "?": { label: "?", color: "text-text-muted bg-surface-hover" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG["?"];
}

export function GitDiffViewer({ projectName, repoName }: GitDiffViewerProps) {
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitFileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get<GitFileStatus[]>(
        `/projects/${projectName}/repos/${repoName}/status`,
      );
      setFiles(data);
      if (data.length > 0 && !selectedFile) {
        setSelectedFile(data[0].path);
      }
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectName, repoName, selectedFile]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      return;
    }

    setLoadingDiff(true);
    api
      .get<GitFileDiff>(
        `/projects/${projectName}/repos/${repoName}/diff?path=${encodeURIComponent(selectedFile)}`,
      )
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setLoadingDiff(false));
  }, [projectName, repoName, selectedFile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading changes...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-sm">
        No changes detected.
      </div>
    );
  }

  const fileName = selectedFile?.split("/").pop() ?? "";

  return (
    <div className="flex border border-border rounded-md overflow-hidden" style={{ height: 500 }}>
      <div className="w-64 shrink-0 border-r border-border overflow-y-auto bg-surface">
        <div className="px-3 py-2 text-xs font-medium text-text-muted border-b border-border">
          Changes ({files.length})
        </div>
        {files.map((file) => {
          const cfg = getStatusConfig(file.status);
          const isSelected = file.path === selectedFile;
          return (
            <button
              key={file.path}
              onClick={() => setSelectedFile(file.path)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                isSelected
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-surface-hover"
              }`}
            >
              <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${cfg.color}`}>
                {cfg.label}
              </span>
              <span className="truncate" title={file.path}>
                {file.path}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {selectedFile && (
          <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border bg-surface flex items-center gap-2">
            <span className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold ${getStatusConfig(files.find((f) => f.path === selectedFile)?.status ?? "?").color}`}>
              {files.find((f) => f.path === selectedFile)?.status ?? "?"}
            </span>
            <span className="font-mono truncate">{selectedFile}</span>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {loadingDiff ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Loading diff...
            </div>
          ) : diff ? (
            <DiffEditor
              original={diff.original}
              modified={diff.modified}
              language={detectLanguage(fileName)}
              theme="vs-dark"
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: "on",
                renderOverviewRuler: false,
                padding: { top: 4 },
              }}
              loading={
                <div className="flex items-center justify-center h-full text-text-muted text-sm">
                  Loading editor...
                </div>
              }
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Select a file to view diff
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
