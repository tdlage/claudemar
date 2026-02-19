import { Download, FileText, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { useToast } from "../shared/Toast";
import type { AgentFileContent } from "../../lib/types";

export interface OutputFile {
  name: string;
  size: number;
  mtime: string;
}

interface OutputBrowserProps {
  agentName: string;
  files: OutputFile[];
  onRefresh: () => void;
}

export function OutputBrowser({ agentName, files, onRefresh }: OutputBrowserProps) {
  const { addToast } = useToast();

  const handleDownload = async (fileName: string) => {
    try {
      const data = await api.get<AgentFileContent>(`/agents/${agentName}/output/${fileName}`);
      const blob = new Blob([data.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast("error", "Failed to download file");
    }
  };

  const handleDelete = async (fileName: string) => {
    try {
      await api.delete(`/agents/${agentName}/output/${fileName}`);
      onRefresh();
      addToast("success", "File deleted");
    } catch {
      addToast("error", "Failed to delete file");
    }
  };

  if (files.length === 0) {
    return <p className="text-sm text-text-muted">No output files.</p>;
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <Card key={file.name} className="px-4 py-3 flex items-center gap-2">
          <FileText size={14} className="text-text-muted shrink-0" />
          <span className="text-sm text-text-primary truncate flex-1">{file.name}</span>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {(file.size / 1024).toFixed(1)} KB
          </span>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {new Date(file.mtime).toLocaleString()}
          </span>
          <button
            onClick={() => handleDownload(file.name)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-accent transition-colors cursor-pointer"
            title="Download"
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
