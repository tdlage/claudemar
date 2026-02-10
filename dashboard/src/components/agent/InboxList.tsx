import { useState } from "react";
import { Archive, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import type { AgentFileContent } from "../../lib/types";

interface InboxListProps {
  agentName: string;
  files: string[];
  onRefresh: () => void;
}

export function InboxList({ agentName, files, onRefresh }: InboxListProps) {
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
        const data = await api.get<AgentFileContent>(`/agents/${agentName}/inbox/${file}`);
        setContents((prev) => ({ ...prev, [file]: data }));
      } catch {
        addToast("error", "Failed to load file");
      }
    }
  };

  const handleArchive = async (file: string) => {
    try {
      await api.post(`/agents/${agentName}/inbox/${file}/archive`);
      addToast("success", "Message archived");
      onRefresh();
    } catch {
      addToast("error", "Failed to archive");
    }
  };

  const handleDelete = async (file: string) => {
    try {
      await api.delete(`/agents/${agentName}/inbox/${file}`);
      addToast("success", "Message deleted");
      onRefresh();
    } catch {
      addToast("error", "Failed to delete");
    }
  };

  if (files.length === 0) {
    return <p className="text-sm text-text-muted">No inbox messages.</p>;
  }

  return (
    <div className="space-y-2">
      {files.map((file) => {
        const isExpanded = expanded === file;
        const senderMatch = file.match(/^DE-([a-zA-Z0-9._-]+)/);
        const sender = senderMatch ? senderMatch[1] : "unknown";

        return (
          <Card key={file} className="p-0 overflow-hidden">
            <button
              onClick={() => toggleExpand(file)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="text-xs text-accent font-medium min-w-[80px]">{sender}</span>
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
                  <Button size="sm" variant="secondary" onClick={() => handleArchive(file)}>
                    <Archive size={12} className="mr-1" /> Archive
                  </Button>
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
