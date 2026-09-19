import { useState, useCallback, useEffect, createContext, useContext } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";

interface ToastItem {
  id: number;
  type: "success" | "error" | "warning" | "info";
  message: string;
}

interface ToastContextValue {
  addToast: (type: ToastItem["type"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastItem["type"], message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-stack fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <ToastEntry key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || toast.type === "error") return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.type === "warning" ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss, paused]);

  const icons = {
    success: <CheckCircle size={16} className="text-success" />,
    error: <AlertCircle size={16} className="text-danger" />,
    warning: <AlertTriangle size={16} className="text-warning" />,
    info: <Info size={16} className="text-accent" />,
  };

  return (
    <div role={toast.type === "error" ? "alert" : "status"} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} className={`toast-entry toast-${toast.type} bg-surface border border-border rounded-lg p-4 shadow-xl flex items-start gap-3`}>
      {icons[toast.type]}
      <span className="text-sm text-text-primary flex-1">{toast.message}</span>
      <button type="button" aria-label="Dispensar notificação" onClick={() => onDismiss(toast.id)} className="icon-button small">
        <X size={14} />
      </button>
    </div>
  );
}
