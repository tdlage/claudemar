import { useState } from "react";
import { Trash2, Play } from "lucide-react";
import { Badge } from "../shared/Badge";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { useTestRuns, useTestRunComments } from "../../hooks/useTracker";
import { MediaUpload, type MediaFile } from "./MediaUpload";
import { CreateTestRunModal } from "./CreateTestRunModal";
import { AttachmentPreview } from "./AttachmentPreview";
import { TEST_RUN_STATUS_CONFIG } from "./constants";
import type { TrackerTestRun } from "../../lib/types";

interface Props {
  testCaseId: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function RunDetail({ run }: { run: TrackerTestRun }) {
  const { addToast } = useToast();
  const { comments } = useTestRunComments(run.id);
  const [commentText, setCommentText] = useState("");
  const [commentFiles, setCommentFiles] = useState<MediaFile[]>([]);
  const [posting, setPosting] = useState(false);

  const handlePostComment = async () => {
    if (!commentText.trim() || posting) return;
    setPosting(true);
    try {
      await api.post("/tracker/test-run-comments", {
        testRunId: run.id,
        content: commentText.trim(),
        attachments: commentFiles.map((f) => ({
          base64: f.base64,
          filename: f.filename,
          mimeType: f.mimeType,
        })),
      });
      setCommentText("");
      setCommentFiles([]);
    } catch {
      addToast("error", "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  const cfg = TEST_RUN_STATUS_CONFIG[run.status];

  return (
    <div className="border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={cfg.variant}>{cfg.icon} {run.status}</Badge>
          {run.durationSeconds != null && (
            <span className="text-xs text-text-muted">{formatDuration(run.durationSeconds)}</span>
          )}
        </div>
        <div className="text-xs text-text-muted">
          {run.executedByName} — {new Date(run.executedAt).toLocaleString()}
        </div>
      </div>

      {run.notes && (
        <p className="text-sm text-text-secondary whitespace-pre-wrap">{run.notes}</p>
      )}

      {run.attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {run.attachments.map((att) => (
            <AttachmentPreview key={att.id} filename={att.filename} mimeType={att.mimeType} className="w-20 h-20" />
          ))}
        </div>
      )}

      <div className="border-t border-border pt-2 space-y-2">
        <p className="text-xs font-medium text-text-muted">Comments</p>
        {comments.map((c) => (
          <div key={c.id} className="bg-bg rounded p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-text-primary">{c.authorName}</span>
              <span className="text-[10px] text-text-muted">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-xs text-text-secondary whitespace-pre-wrap">{c.content}</p>
            {c.attachments.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                {c.attachments.map((att) => (
                  <AttachmentPreview key={att.id} filename={att.filename} mimeType={att.mimeType} className="w-12 h-12" />
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            rows={1}
            className="flex-1 bg-bg border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
          />
          <button
            onClick={handlePostComment}
            disabled={!commentText.trim() || posting}
            className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
          >
            Post
          </button>
        </div>
        <MediaUpload files={commentFiles} onChange={setCommentFiles} acceptVideo />
      </div>
    </div>
  );
}

export function TestRunPanel({ testCaseId }: Props) {
  const { addToast } = useToast();
  const { runs } = useTestRuns(testCaseId);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const handleDeleteRun = async (id: string) => {
    if (!confirm("Delete this test run?")) return;
    try {
      await api.delete(`/tracker/test-runs/${id}`);
    } catch {
      addToast("error", "Failed to delete test run");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Test Runs</p>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Play size={12} /> Run Test
        </button>
      </div>

      {runs.length === 0 && <p className="text-xs text-text-muted">No test runs yet.</p>}

      <div className="space-y-2">
        {runs.map((run) => {
          const cfg = TEST_RUN_STATUS_CONFIG[run.status];
          const isExpanded = expandedRun === run.id;

          return (
            <div key={run.id}>
              <div
                onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                className="flex items-center justify-between bg-surface border border-border rounded-md px-3 py-2 cursor-pointer hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={cfg.variant}>{cfg.icon} {run.status}</Badge>
                  <span className="text-xs text-text-secondary">{run.executedByName}</span>
                  {run.durationSeconds != null && (
                    <span className="text-xs text-text-muted">{formatDuration(run.durationSeconds)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">{new Date(run.executedAt).toLocaleString()}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
                    className="text-text-muted hover:text-danger"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {isExpanded && <RunDetail run={run} />}
            </div>
          );
        })}
      </div>

      <CreateTestRunModal open={createOpen} onClose={() => setCreateOpen(false)} testCaseId={testCaseId} />
    </div>
  );
}
