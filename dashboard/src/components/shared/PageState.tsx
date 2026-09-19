import { AlertCircle, LoaderCircle, type LucideIcon } from "lucide-react";
import { Button } from "./Button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon size={26} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return (
    <div role="status" className="loading-state">
      <LoaderCircle size={20} className="animate-spin text-accent" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="error-state">
      <AlertCircle size={20} className="shrink-0" />
      <div>
        <p>{message}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={onRetry}
        >
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
