import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { markdownExtensions, getEditorMarkdown } from "./markdownTiptap";

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  const editor = useEditor({
    extensions: markdownExtensions({ editable: false }),
    editable: false,
    content,
    editorProps: {
      attributes: {
        class: "prose-editor outline-none text-sm",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (getEditorMarkdown(editor) !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className={`markdown-editor ${className ?? ""}`.trim()}>
      <EditorContent editor={editor} />
    </div>
  );
}
