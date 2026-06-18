import { useState, useEffect, useCallback } from "react";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api";
import { isAdmin } from "../../hooks/useAuth";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";

interface EnvKeyStatus {
  key: string;
  label: string;
  group: string;
  help: string;
  required: boolean;
  present: boolean;
}

const DISMISS_KEY = "apikeys_setup_dismissed";
export const OPEN_API_KEYS_EVENT = "claudemar:open-api-keys";

export function ApiKeysSetup() {
  const { addToast } = useToast();
  const [status, setStatus] = useState<EnvKeyStatus[]>([]);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [savedKeys, setSavedKeys] = useState<string[]>([]);

  const load = useCallback(async (autoOpen: boolean) => {
    try {
      const data = await api.get<EnvKeyStatus[]>("/system/env");
      setStatus(data);
      if (autoOpen && data.some((k) => !k.present) && !sessionStorage.getItem(DISMISS_KEY)) {
        setOpen(true);
      }
    } catch {
      // sem permissão (usuário comum) ou indisponível — ignora
    }
  }, []);

  useEffect(() => {
    if (!isAdmin()) return;
    load(true);
    const handler = () => { setSavedKeys([]); setValues({}); setOpen(true); load(false); };
    window.addEventListener(OPEN_API_KEYS_EVENT, handler);
    return () => window.removeEventListener(OPEN_API_KEYS_EVENT, handler);
  }, [load]);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  };

  const handleSave = async () => {
    const payload = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
    );
    if (Object.keys(payload).length === 0) {
      dismiss();
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ updated: string[] }>("/system/env", { values: payload });
      setSavedKeys(res.updated);
      setValues({});
      await load(false);
      addToast("success", `${res.updated.length} chave(s) salva(s) no .env`);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      const before = await api.get<{ uptime: number }>("/system/status").then((s) => s.uptime).catch(() => Infinity);
      await api.post("/system/restart");
      addToast("success", "Reiniciando o serviço — a página recarregará quando voltar.");
      const startedAt = Date.now();
      const poll = setInterval(async () => {
        if (Date.now() - startedAt > 120000) { clearInterval(poll); setRestarting(false); return; }
        try {
          const s = await api.get<{ uptime: number }>("/system/status");
          if (s.uptime < before) { clearInterval(poll); window.location.reload(); }
        } catch { /* serviço ainda reiniciando */ }
      }, 3000);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Falha ao reiniciar");
      setRestarting(false);
    }
  };

  if (!isAdmin()) return null;

  const groups = [...new Set(status.map((k) => k.group))];

  return (
    <Modal open={open} onClose={dismiss} title="Chaves de API">
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          Configure aqui as chaves que faltam — elas são gravadas no <code>.env</code> do servidor,
          sem precisar acessar a máquina. Deixe em branco para manter o valor atual.
        </p>

        {groups.map((group) => (
          <div key={group} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-text-muted tracking-wide">{group}</h3>
            {status.filter((k) => k.group === group).map((k) => (
              <div key={k.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{k.label}</span>
                  {k.present ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 size={12} /> configurado
                    </span>
                  ) : (
                    <span className="text-xs text-warning">faltando</span>
                  )}
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={values[k.key] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [k.key]: e.target.value }))}
                  placeholder={k.present ? "•••••••• (configurado)" : `Cole a ${k.label}`}
                  className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <p className="text-xs text-text-muted">{k.help}</p>
              </div>
            ))}
          </div>
        ))}

        {savedKeys.length > 0 && (
          <div className="flex items-center justify-between gap-3 border border-warning/40 bg-warning/10 rounded-md px-3 py-2">
            <span className="text-xs text-text-secondary">
              Salvo. Reinicie o serviço para aplicar (a memória/transcrição só liga após reiniciar).
            </span>
            <Button onClick={handleRestart} disabled={restarting}>
              {restarting ? "Reiniciando..." : "Reiniciar agora"}
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="px-3 py-1.5 rounded-md text-sm text-text-muted hover:text-text-primary"
          >
            Agora não
          </button>
          <Button onClick={handleSave} disabled={saving}>
            <KeyRound size={14} className="mr-1.5" />
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
