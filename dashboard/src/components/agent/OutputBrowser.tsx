import { useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import type { AgentFileContent } from "../../lib/types";

interface OutputFile {
  name: string;
  size: number;
  mtime: string;
}

interface OutputBrowserProps {
  agentName: string;
  files: OutputFile[];
}

export function OutputBrowser({ agentName, files }: OutputBrowserProps) {
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});

  const toggleExpand = async (file: string) => {
    if (expanded === file) {
      setExpanded(null);
      return;
    }
    setExpanded(file);
    if (contents[file] === undefined) {
      try {
        const data = await api.get<AgentFileContent>(`/agents/${agentName}/output/${file}`);
        setContents((prev) => ({ ...prev, [file]: data.content }));
      } catch {
        addToast("error", "Failed to load file");
      }
    }
  };

  const handleDownload = (fileName: string) => {
    const content = contents[fileName];
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (files.length === 0) {
    return <p className="text-sm text-text-muted">No output files.</p>;
  }

  return (
    <div className="space-y-2">
      {files.map((file) => {
        const isExpanded = expanded === file.name;

        return (
          <Card key={file.name} className="p-0 overflow-hidden">
            <button
              onClick={() => toggleExpand(file.name)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <FileText size={14} className="text-text-muted" />
              <span className="text-sm text-text-primary truncate flex-1">{file.name}</span>
              <span className="text-xs text-text-muted">
                {(file.size / 1024).toFixed(1)} KB
              </span>
              <span className="text-xs text-text-muted">
                {new Date(file.mtime).toLocaleString()}
              </span>
            </button>

            {isExpanded && (
              <div className="border-t border-border">
                {contents[file.name] !== undefined ? (
                  <pre className="px-4 py-3 text-sm text-text-secondary whitespace-pre-wrap overflow-auto max-h-96 bg-bg font-mono">
                    {contents[file.name]}
                  </pre>
                ) : (
                  <p className="px-4 py-3 text-sm text-text-muted">Loading...</p>
                )}
                <div className="flex gap-2 px-4 py-2 border-t border-border bg-surface">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDownload(file.name)}
                    disabled={contents[file.name] === undefined}
                  >
                    <Download size={12} className="mr-1" /> Download
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
