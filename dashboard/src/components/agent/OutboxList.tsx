import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import type { AgentFileContent } from "../../lib/types";

interface OutboxListProps {
  agentName: string;
  files: string[];
  onRefresh: () => void;
}

export function OutboxList({ agentName, files, onRefresh }: OutboxListProps) {
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, AgentFileContent>>({});

  const toggleExpand = async (file: string) => {
    if (expanded === file) {
      setExpanded(null);
      return;
    }
    setExpanded(file);
    if (!contents[file]) {
      try {
        const data = await api.get<AgentFileContent>(`/agents/${agentName}/outbox/${file}`);
        setContents((prev) => ({ ...prev, [file]: data }));
      } catch {
        addToast("error", "Failed to load file");
      }
    }
  };

  const handleDelete = async (file: string) => {
    try {
      await api.delete(`/agents/${agentName}/outbox/${file}`);
      addToast("success", "Message deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete");
    }
  };

  if (files.length === 0) {
    return <p className="text-sm text-text-muted">No outbox messages.</p>;
  }

  return (
    <div className="space-y-2">
      {files.map((file) => {
        const isExpanded = expanded === file;
        const destMatch = file.match(/^PARA-([a-zA-Z0-9._-]+)/);
        const destination = destMatch ? destMatch[1] : "unknown";

        return (
          <Card key={file} className="p-0 overflow-hidden">
            <button
              onClick={() => toggleExpand(file)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="text-xs text-accent font-medium min-w-[80px]">{destination}</span>
              <span className="text-sm text-text-primary truncate flex-1">{file}</span>
            </button>

            {isExpanded && (
              <div className="border-t border-border">
                {contents[file] ? (
                  <pre className="px-4 py-3 text-sm text-text-secondary whitespace-pre-wrap overflow-auto max-h-80 bg-bg">
                    {contents[file].content}
                  </pre>
                ) : (
                  <p className="px-4 py-3 text-sm text-text-muted">Loading...</p>
                )}
                <div className="flex gap-2 px-4 py-2 border-t border-border bg-surface">
                  <Button size="sm" variant="danger" onClick={() => handleDelete(file)}>
                    <Trash2 size={12} className="mr-1" /> Delete
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
