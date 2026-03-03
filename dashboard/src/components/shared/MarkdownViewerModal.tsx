import { useState, useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { X, Loader2 } from "lucide-react";
import { api } from "../../lib/api";

const lowlight = createLowlight(common);

interface MarkdownViewerModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  base: string;
}

export function MarkdownViewerModal({ open, onClose, filePath, base }: MarkdownViewerModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({ openOnClick: true }),
      Markdown.configure({ html: false }),
    ],
    editable: false,
    editorProps: {
      attributes: {
        class: "prose-editor outline-none px-4 py-3 text-sm",
      },
    },
  });

  const load = useCallback(async () => {
    if (!open || !filePath) return;
    setLoading(true);
    setError(null);
    setContent(null);
    try {
      const data = await api.get<{ type: string; content: string }>(`/files?base=${encodeURIComponent(base)}&path=${encodeURIComponent(filePath)}`);
      if (data.type === "file" && data.content) {
        setContent(data.content);
      } else {
        setError("Not a file or empty content");
      }
    } catch {
      setError("Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [open, filePath, base]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (editor && content !== null) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-lg shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-medium font-mono truncate">{filePath}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary ml-2 shrink-0">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto markdown-editor">
          {loading && (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}
          {error && (
            <div className="p-4 text-sm text-danger">{error}</div>
          )}
          {!loading && !error && editor && (
            <EditorContent editor={editor} />
          )}
        </div>
      </div>
    </div>
  );
}
