import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import type { Extensions } from "@tiptap/react";

const lowlight = createLowlight(common);

interface MarkdownExtensionsOptions {
  placeholder?: string;
  editable?: boolean;
}

export function markdownExtensions({ placeholder, editable = true }: MarkdownExtensionsOptions = {}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({ codeBlock: false, link: false }),
    CodeBlockLowlight.configure({ lowlight }),
    Link.configure({ openOnClick: !editable }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      html: false,
      transformCopiedText: true,
      transformPastedText: true,
    }),
  ];
  if (placeholder !== undefined) {
    extensions.push(Placeholder.configure({ placeholder }));
  }
  return extensions;
}

export function getEditorMarkdown(editor: { storage: unknown }): string {
  const storage = editor.storage as Record<string, { getMarkdown: () => string }>;
  return storage.markdown.getMarkdown();
}
