import { useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogFocus } from "../../hooks/useDialogFocus";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  dismissible?: boolean;
  size?: "default" | "lg" | "xl";
  children: React.ReactNode;
}

const SIZE_CLASSES = {
  default: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, size = "default", dismissible = true, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { if (dismissible) onClose(); };
  useDialogFocus(ref, open, close);

  if (!open) return null;

  return createPortal(
    <div className="modal-layer fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={close} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`modal-panel relative bg-surface border border-border rounded-t-2xl md:rounded-lg shadow-2xl ${SIZE_CLASSES[size]} w-full md:mx-4 flex flex-col outline-none`}>
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium">{title}</h3>
          <button type="button" onClick={close} disabled={!dismissible} aria-label="Fechar" className="flex items-center justify-center w-11 h-11 md:w-7 md:h-7 rounded text-text-muted hover:text-text-primary disabled:opacity-40">
            <X size={16} />
          </button>
        </div>
        <div className="modal-content p-4 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>, document.body,
  );
}
