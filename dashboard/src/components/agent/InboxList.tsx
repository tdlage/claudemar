import { useState } from "react";
import { Archive, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { MarkdownViewerModal } from "../shared/MarkdownViewerModal";
import { renderOutputHtml } from "../../lib/ansi";
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
  const [viewerFile, setViewerFile] = useState<string | null>(null);

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
              <button
                onClick={(e) => { e.stopPropagation(); setViewerFile(file); }}
                className="text-sm text-accent hover:underline truncate flex-1 text-left"
              >
                {file}
              </button>
            </button>

            {isExpanded && (
              <div className="border-t border-border">
                {contents[file] ? (
                  <div
                    className="activity-output px-4 py-3 text-sm text-text-secondary overflow-auto max-h-80 bg-bg"
                    dangerouslySetInnerHTML={{ __html: renderOutputHtml(contents[file].content) }}
                  />
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
      {viewerFile && (
        <MarkdownViewerModal
          open
          onClose={() => setViewerFile(null)}
          filePath={`inbox/${viewerFile}`}
          base={`agent:${agentName}`}
        />
      )}
    </div>
  );
}
