import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Eye,
  EyeOff,
  Fingerprint,
  Folder,
  KeyRound,
  ListTodo,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/shared/Button";
import { Brand } from "../components/shared/Brand";
import { ThemeToggle } from "../components/shared/ThemeToggle";
import { Field, Input } from "../vendor/dantui";
import {
  isPasskeySupported,
  loginWithPasskey,
  getPasskeyStatus,
} from "../lib/passkey";
import { useMobileViewport } from "../hooks/useMobile";

export function LoginPage() {
  useMobileViewport();
  const { login, isAuthenticated } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"token" | "passkey" | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    document.title = "Entrar · Claudemar";
    if (isPasskeySupported())
      getPasskeyStatus()
        .then((s) => setPasskeyEnabled(s.enabled))
        .catch(() => setPasskeyEnabled(false));
  }, []);
  if (isAuthenticated) return <Navigate to="/" replace />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading("token");
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (!res.ok) {
        setError(
          res.status === 401 || res.status === 403
            ? "Este token não é válido ou expirou. Confira o código e tente novamente."
            : res.status === 429
              ? "Muitas tentativas de acesso. Aguarde um pouco antes de tentar novamente."
              : "O serviço está indisponível no momento. Tente novamente em instantes.",
        );
        return;
      }
      await login(token.trim());
    } catch {
      setError(
        "Não foi possível conectar. Verifique sua conexão e tente novamente.",
      );
    } finally {
      submitting.current = false;
      setLoading(null);
    }
  };
  const passkeyLogin = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setLoading("passkey");
    try {
      const { token: passkeyToken } = await loginWithPasskey();
      await login(passkeyToken);
    } catch {
      setError(
        "A autenticação não foi concluída. Tente novamente ou entre com seu token de acesso.",
      );
    } finally {
      submitting.current = false;
      setLoading(null);
    }
  };
  return (
    <div className="login-page">
      <header className="login-header">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="login-main">
        <section className="login-intro" aria-labelledby="login-intro-title">
          <p className="eyebrow">Menos dispersão. Mais possibilidades.</p>
          <h1 id="login-intro-title">
            Suas ideias. <br />
            Seus agentes. <br />
            <span>Seu próximo passo.</span>
          </h1>
          <p className="login-description">
            Um espaço para trabalhar com inteligência artificial, do primeiro
            pedido ao projeto em andamento.
          </p>
          <div className="login-features">
            <div>
              <Folder size={19} />
              <span>
                <strong>Contexto organizado</strong>
                <span>Conversas, arquivos e repositórios por projeto.</span>
              </span>
            </div>
            <div>
              <Bot size={19} />
              <span>
                <strong>Assistentes com propósito</strong>
                <span>Agentes especializados no seu jeito de trabalhar.</span>
              </span>
            </div>
            <div>
              <ListTodo size={19} />
              <span>
                <strong>Clareza para continuar</strong>
                <span>Tarefas e execuções em um só lugar.</span>
              </span>
            </div>
          </div>
          <div className="login-terminal-mark" aria-hidden="true">
            <span>&gt;_</span> espaço para construir
            <span className="terminal-cursor" />
          </div>
        </section>
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-card-rail">
            <span className="status-dot bg-accent" />
            <span>CLAUDEMAR / ACESSO</span>
            <KeyRound size={14} />
          </div>
          <div className="login-card-body">
            <p className="eyebrow">Bom ter você aqui</p>
            <h2 id="login-title">Entre no seu workspace</h2>
            <p className="text-sm text-text-secondary mb-7">
              Use seu token de acesso para continuar.
            </p>
            <form onSubmit={submit} className="space-y-5">
              <Field
                label="Token de acesso"
                hint="Cole o token fornecido pelo administrador do seu workspace."
              >
                {(props) => (
                  <div className="password-field">
                    <Input
                      {...props}
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value);
                        setError("");
                      }}
                      placeholder="Seu token de acesso"
                      autoComplete="current-password"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      disabled={!!loading}
                      aria-invalid={!!error}
                      aria-describedby={
                        error ? "login-error" : props["aria-describedby"]
                      }
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
              {error && (
                <p id="login-error" role="alert" className="login-error">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="success"
                loading={loading === "token"}
                disabled={!!loading || !token.trim()}
                className="w-full"
              >
                Entrar no workspace <ArrowRight size={16} />
              </Button>
            </form>
            {passkeyEnabled && (
              <>
                <div className="login-divider">
                  <span>ou</span>
                </div>
                <Button
                  variant="secondary"
                  disabled={!!loading}
                  loading={loading === "passkey"}
                  onClick={passkeyLogin}
                  className="w-full"
                >
                  <Fingerprint size={18} /> Entrar com biometria / passkey
                </Button>
              </>
            )}
            <details className="login-help">
              <summary>Como consigo meu token?</summary>
              <p>
                Peça seu token ao administrador do workspace. Se você administra
                o Claudemar pelo Telegram, envie <code>/token</code> ao bot para
                obter seu acesso.
              </p>
            </details>
          </div>
          <div className="login-card-footer">
            <KeyRound size={13} />
            <span>Seu acesso é pessoal. Não compartilhe seu token.</span>
          </div>
        </section>
      </main>
      <footer className="login-footer">
        <span>Claudemar</span>
        <span>Um espaço para ideias virarem trabalho.</span>
      </footer>
    </div>
  );
}
