import { useState } from "react";
import { ShieldQuestion, Check, CheckCheck, X, ChevronDown, ChevronRight } from "lucide-react";

export interface PermissionRequest {
  reqId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface PermissionPromptProps {
  request: PermissionRequest;
  onDecision: (reqId: string, decision: "allow" | "always" | "deny") => void;
}

export function PermissionPrompt({ request, onDecision }: PermissionPromptProps) {
  const [showInput, setShowInput] = useState(false);

  return (
    <div className="border border-amber-500/40 bg-amber-500/5 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-amber-400">
        <ShieldQuestion size={18} />
        <span className="text-sm font-medium text-text-primary">
          Permitir <span className="font-mono text-amber-400">{request.toolName}</span>?
        </span>
      </div>

      <button
        type="button"
        onClick={() => setShowInput((v) => !v)}
        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        {showInput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Ver input
      </button>
      {showInput && (
        <pre className="text-xs bg-bg rounded-md p-2 border border-border overflow-auto max-h-48 text-text-secondary whitespace-pre-wrap break-words">
          {JSON.stringify(request.input, null, 2)}
        </pre>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => onDecision(request.reqId, "allow")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
        >
          <Check size={14} />
          Permitir
        </button>
        <button
          onClick={() => onDecision(request.reqId, "always")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-surface border border-border hover:border-border-hover text-text-primary transition-colors"
        >
          <CheckCheck size={14} />
          Sempre
        </button>
        <button
          onClick={() => onDecision(request.reqId, "deny")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-surface border border-border hover:border-danger text-text-secondary hover:text-danger transition-colors"
        >
          <X size={14} />
          Negar
        </button>
      </div>
    </div>
  );
}
