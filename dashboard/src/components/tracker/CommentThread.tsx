import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { useComments } from "../../hooks/useTracker";
import { MediaUpload, type MediaFile } from "./MediaUpload";
import { AttachmentPreview } from "./AttachmentPreview";

interface Props {
  targetType: "bet" | "scope";
  targetId: string;
}

export function CommentThread({ targetType, targetId }: Props) {
  const { addToast } = useToast();
  const { comments } = useComments(targetType, targetId);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [posting, setPosting] = useState(false);

  const handlePost = async () => {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      const attachments = files.map((f) => ({
        base64: f.base64,
        filename: f.filename,
        mimeType: f.mimeType,
      }));
      await api.post("/tracker/comments", {
        targetType,
        targetId,
        content: content.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      setContent("");
      setFiles([]);
    } catch (e: unknown) {
      addToast("error", e instanceof Error ? e.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/tracker/comments/${id}`);
    } catch {
      addToast("error", "Failed to delete comment");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {comments.map((c) => (
          <div key={c.id} className="bg-surface border border-border rounded-lg p-3 group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-medium">
                  {c.authorName.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm font-medium text-text-primary">{c.authorName}</span>
                <span className="text-xs text-text-muted">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                className="text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{c.content}</p>
            {c.attachments.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {c.attachments.map((att) => (
                  <AttachmentPreview key={att.id} filename={att.filename} mimeType={att.mimeType} />
                ))}
              </div>
            )}
          </div>
        ))}
        {comments.length === 0 && (
          <p className="text-sm text-text-muted">No comments yet.</p>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a comment..."
          rows={3}
          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y"
        />
        <MediaUpload files={files} onChange={setFiles} acceptVideo />
        <div className="flex justify-end">
          <button
            onClick={handlePost}
            disabled={!content.trim() || posting}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors"
          >
            {posting ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
