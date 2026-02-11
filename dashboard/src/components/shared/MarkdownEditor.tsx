import { useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link as LinkIcon,
  CodeSquare,
  Undo,
  Redo,
} from "lucide-react";

const lowlight = createLowlight(common);

interface MarkdownEditorProps {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  onSave?: () => void;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-accent/20 text-accent"
          : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarSep() {
  return <div className="w-px h-5 bg-border mx-0.5" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  const s = 14;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface rounded-t-md flex-wrap">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
        <Bold size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
        <Italic size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough">
        <Strikethrough size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">
        <Code size={s} />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1">
        <Heading1 size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">
        <Heading2 size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">
        <Heading3 size={s} />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
        <List size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Ordered list">
        <ListOrdered size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Blockquote">
        <Quote size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block">
        <CodeSquare size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
        <Minus size={s} />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton onClick={setLink} active={editor.isActive("link")} title="Link">
        <LinkIcon size={s} />
      </ToolbarButton>

      <ToolbarSep />

      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <Undo size={s} />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <Redo size={s} />
      </ToolbarButton>
    </div>
  );
}

export function MarkdownEditor({ value, onChange, placeholder, onSave }: MarkdownEditorProps) {
  const suppressUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? "Write markdown..." }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      if (suppressUpdate.current) return;
      const storage = (ed.storage as unknown as Record<string, { getMarkdown: () => string }>);
      onChange(storage.markdown.getMarkdown());
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          onSave?.();
          return true;
        }
        return false;
      },
      attributes: {
        class: "prose-editor outline-none min-h-[300px] px-4 py-3 text-sm",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as Record<string, { getMarkdown: () => string }>);
    const currentMd = storage.markdown.getMarkdown();
    if (currentMd !== value) {
      suppressUpdate.current = true;
      editor.commands.setContent(value);
      suppressUpdate.current = false;
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="border border-border rounded-md bg-bg overflow-hidden markdown-editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
