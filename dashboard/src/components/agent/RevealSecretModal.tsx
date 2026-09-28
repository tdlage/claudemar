import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { isAdmin } from "../../hooks/useAuth";
import { getPasskeyStatus, isPasskeySupported, passkeyAssertion } from "../../lib/passkey";
import { Modal } from "../shared/Modal";
import { Button } from "../shared/Button";
import { Field, Input } from "../../vendor/dantui";
import type { AgentSecret } from "../../lib/types";

interface RevealSecretModalProps {
  agentName: string;
  secret: AgentSecret | null;
  onClose: () => void;
}

const FAILURE_MESSAGE = "Não foi possível confirmar sua identidade. Confira o token e tente novamente.";

export function RevealSecretModal({ agentName, secret, onClose }: RevealSecretModalProps) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"token" | "passkey" | null>(null);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!secret) return;
    setToken("");
    setShowToken(false);
    setError("");
    setValue(null);
    setCopied(false);
    if (isAdmin() && isPasskeySupported()) {
      getPasskeyStatus().then((status) => setPasskeyEnabled(status.enabled)).catch(() => setPasskeyEnabled(false));
    }
  }, [secret]);

  const close = () => {
    setValue(null);
    setToken("");
    onClose();
  };

  const reveal = async (method: "token" | "passkey") => {
    if (!secret || submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading(method);
    try {
      const body = method === "token" ? { method, token: token.trim() } : { method, ...(await passkeyAssertion()) };
      const result = await api.post<{ value: string }>(`/agents/${encodeURIComponent(agentName)}/secrets/${encodeURIComponent(secret.id)}/reveal`, body);
      setToken("");
      setValue(result.value);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message.startsWith("Muitas tentativas") ? message : method === "passkey"
        ? "A autenticação não foi concluída. Tente novamente ou use seu token de acesso."
        : FAILURE_MESSAGE);
    } finally {
      submitting.current = false;
      setLoading(null);
    }
  };

  const copy = async () => {
    if (value === null) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={secret !== null} onClose={close} title="Ver credencial">
      <section className="login-card" aria-labelledby="reveal-secret-title">
        <div className="login-card-rail">
          <span className={`status-dot ${value === null ? "bg-accent" : "bg-success"}`} />
          <span>CLAUDEMAR / CREDENCIAL</span>
          <KeyRound size={14} />
        </div>
        <div className="login-card-body">
          {value === null ? (
            <>
              <p className="eyebrow">Credencial protegida</p>
              <h2 id="reveal-secret-title">Confirme que é você</h2>
              <p className="text-sm text-text-secondary mb-7">
                Para ver o valor de <code className="font-mono text-text-primary">{secret?.name}</code>, informe novamente seu token de acesso.
              </p>
              <form onSubmit={(event) => { event.preventDefault(); if (token.trim()) void reveal("token"); }} className="space-y-5">
                <Field label="Token de acesso" hint="O mesmo token usado para entrar no workspace.">
                  {(props) => (
                    <div className="password-field">
                      <Input
                        {...props}
                        type={showToken ? "text" : "password"}
                        value={token}
                        onChange={(e) => { setToken(e.target.value); setError(""); }}
                        placeholder="Seu token de acesso"
                        autoComplete="current-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoFocus
                        required
                        disabled={!!loading}
                        aria-invalid={!!error}
                        aria-describedby={error ? "reveal-secret-error" : props["aria-describedby"]}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                        aria-pressed={showToken}
                        onClick={() => setShowToken(!showToken)}
                      >
                        {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  )}
                </Field>
                {error && <p id="reveal-secret-error" role="alert" className="login-error">{error}</p>}
                <Button type="submit" variant="success" loading={loading === "token"} disabled={!!loading || !token.trim()} className="w-full">
                  <ShieldCheck size={16} /> Confirmar e ver valor
                </Button>
              </form>
              {passkeyEnabled && (
                <>
                  <div className="login-divider"><span>ou</span></div>
                  <Button variant="secondary" disabled={!!loading} loading={loading === "passkey"} onClick={() => void reveal("passkey")} className="w-full">
                    <Fingerprint size={18} /> Confirmar com biometria / passkey
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <p className="eyebrow">Identidade confirmada</p>
              <h2 id="reveal-secret-title" className="font-mono">{secret?.name}</h2>
              <div className="mt-5 flex items-start gap-2 rounded-md border border-border bg-bg p-3">
                <code className="flex-1 min-w-0 whitespace-pre-wrap break-all font-mono text-sm text-text-primary select-all">{value}</code>
                <button type="button" className="icon-button" onClick={() => void copy()} aria-label="Copiar valor" title="Copiar valor">
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </button>
              </div>
              <Button variant="secondary" onClick={close} className="w-full mt-5">
                <EyeOff size={16} /> Ocultar e fechar
              </Button>
            </>
          )}
        </div>
        <div className="login-card-footer">
          <KeyRound size={13} />
          <span>O valor só fica visível nesta janela. Não compartilhe credenciais.</span>
        </div>
      </section>
    </Modal>
  );
}
