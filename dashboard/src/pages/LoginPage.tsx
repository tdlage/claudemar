import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/shared/Button";
import { isPasskeySupported, loginWithPasskey, getPasskeyStatus } from "../lib/passkey";

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
    getPasskeyStatus()
      .then((s) => setPasskeyEnabled(s.enabled))
      .catch(() => setPasskeyEnabled(false));
  }, []);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setError("Invalid token");
        return;
      }

      await login(token);
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const { token: passkeyToken } = await loginWithPasskey();
      await login(passkeyToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="bg-surface border border-border rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-lg font-semibold text-text-primary mb-1">Claudemar</h1>
        <p className="text-sm text-text-muted mb-6">
          Enter your dashboard token to continue.
          <br />
          <span className="text-xs">Use <code>/token</code> in Telegram to get the current token.</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Dashboard token"
            autoFocus
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Connecting..." : "Login"}
          </Button>
        </form>

        {passkeySupported && passkeyEnabled && (
          <>
            <div className="flex items-center gap-3 my-4">
              <div className="h-px bg-border flex-1" />
              <span className="text-xs text-text-muted">or</span>
              <div className="h-px bg-border flex-1" />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={handlePasskeyLogin}
              className="w-full"
            >
              {loading ? "Authenticating..." : "Login with Touch ID / Passkey"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
