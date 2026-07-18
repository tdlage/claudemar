import { useEffect, useState, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { isAdmin } from "../../hooks/useAuth";
import { ClaudeLoginModal } from "./ClaudeLoginModal";

interface AuthStatus {
  present: boolean;
  expiresAt: number | null;
  expired: boolean;
  authError: { at: number; message: string } | null;
}

export function ClaudeAuthBanner() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [showModal, setShowModal] = useState(false);
  const admin = isAdmin();

  const refresh = useCallback(() => {
    if (!admin) return;
    api.get<AuthStatus>("/system/claude-auth").then(setStatus).catch(() => {});
  }, [admin]);

  useEffect(() => {
    if (!admin) return;
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [admin, refresh]);

  if (!admin) return null;

  const needsRelogin = Boolean(status?.authError) || status?.present === false;
  if (!needsRelogin && !showModal) return null;

  return (
    <>
      {needsRelogin && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/15 border-b border-warning/30 text-warning text-xs shrink-0">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1 min-w-0">
            Sessão do Claude (subscription) sem autenticação válida — as execuções vão falhar até reconectar.
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="shrink-0 px-2 py-1 rounded bg-warning/20 hover:bg-warning/30 font-medium transition-colors"
          >
            Reconectar
          </button>
        </div>
      )}
      <ClaudeLoginModal open={showModal} onClose={() => setShowModal(false)} onDone={refresh} />
    </>
  );
}
