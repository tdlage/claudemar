import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../shared/Button";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useToast } from "../shared/Toast";

interface AgentConfigProps {
  agentName: string;
  agentsMd: string;
}

export function AgentConfig({ agentName, agentsMd }: AgentConfigProps) {
  const { addToast } = useToast();
  const [mdContent, setMdContent] = useState(agentsMd);
  const [mdDirty, setMdDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMdContent(agentsMd);
    setMdDirty(false);
  }, [agentsMd]);

  const handleSaveMd = async () => {
    setSaving(true);
    try {
      await api.put(`/files?base=agent:${agentName}&path=AGENTS.md`, { content: mdContent });
      setMdDirty(false);
      addToast("success", "AGENTS.md saved");
    } catch {
      addToast("error", "Failed to save AGENTS.md");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">AGENTS.md</h3>
          <Button
            size="sm"
            onClick={handleSaveMd}
            disabled={saving || !mdDirty}
          >
            <Save size={12} className="mr-1" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        <MarkdownEditor
          value={mdContent}
          onChange={(md) => {
            setMdContent(md);
            setMdDirty(true);
          }}
          onSave={handleSaveMd}
          placeholder="Write agent instructions..."
        />
      </div>
    </div>
  );
}
