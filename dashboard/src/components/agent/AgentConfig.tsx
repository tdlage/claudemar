import { useState, useEffect } from "react";
import { Save, Play } from "lucide-react";
import { api } from "../../lib/api";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Badge } from "../shared/Badge";
import { MarkdownEditor } from "../shared/MarkdownEditor";
import { useToast } from "../shared/Toast";
import type { ScheduleEntry } from "../../lib/types";

interface AgentConfigProps {
  agentName: string;
  claudeMd: string;
  schedules: ScheduleEntry[];
}

export function AgentConfig({ agentName, claudeMd, schedules }: AgentConfigProps) {
  const { addToast } = useToast();
  const [mdContent, setMdContent] = useState(claudeMd);
  const [mdDirty, setMdDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMdContent(claudeMd);
    setMdDirty(false);
  }, [claudeMd]);

  const handleSaveMd = async () => {
    setSaving(true);
    try {
      await api.put(`/files?base=agent:${agentName}&path=CLAUDE.md`, { content: mdContent });
      setMdDirty(false);
      addToast("success", "CLAUDE.md saved");
    } catch {
      addToast("error", "Failed to save CLAUDE.md");
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteSchedule = async (schedule: ScheduleEntry) => {
    try {
      await api.post("/executions", {
        targetType: "agent",
        targetName: agentName,
        prompt: schedule.task,
      });
      addToast("success", "Schedule task started");
    } catch {
      addToast("error", "Failed to start task");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-muted">CLAUDE.md</h3>
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

      {schedules.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-muted mb-2">
            Schedules ({schedules.length})
          </h3>
          <div className="space-y-2">
            {schedules.map((s) => (
              <Card key={s.id} className="py-2 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge>{s.cron}</Badge>
                      <span className="text-xs text-text-muted">{s.cronHuman}</span>
                    </div>
                    <p className="text-sm text-text-primary truncate">{s.task}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => handleExecuteSchedule(s)}>
                    <Play size={12} className="mr-1" /> Run Now
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
