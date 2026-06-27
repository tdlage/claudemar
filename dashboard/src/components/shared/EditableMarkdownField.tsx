import { useState, useCallback } from "react";
import { Pencil, Check } from "lucide-react";
import { MarkdownViewer } from "./MarkdownViewer";
import { MarkdownEditor } from "./MarkdownEditor";

interface EditableMarkdownFieldProps {
  value: string;
  onSave: (md: string) => void | Promise<void>;
  placeholder?: string;
  emptyLabel?: string;
  editable?: boolean;
}

export function EditableMarkdownField({
  value,
  onSave,
  placeholder,
  emptyLabel = "Nada por aqui ainda.",
  editable = true,
}: EditableMarkdownFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEditing = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const finishEditing = useCallback(async () => {
    setEditing(false);
    if (draft !== value) {
      await onSave(draft);
    }
  }, [draft, value, onSave]);

  if (editing) {
    return (
      <div className="space-y-2">
        <MarkdownEditor value={draft} onChange={setDraft} onSave={finishEditing} placeholder={placeholder} />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={finishEditing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Check size={12} />
            Concluir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      {value.trim() ? (
        <div className="border border-border rounded-md bg-bg px-3 py-1">
          <MarkdownViewer content={value} />
        </div>
      ) : (
        <p className="text-sm text-text-muted italic px-1 py-2">{emptyLabel}</p>
      )}
      {editable && (
        <button
          type="button"
          onClick={startEditing}
          className="absolute top-1.5 right-1.5 p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover opacity-0 group-hover:opacity-100 transition-opacity"
          title="Editar"
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}
