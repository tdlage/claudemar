import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/shared/Button";

export function LoginPage() {
  const { login } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/system/status", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setError("Invalid token");
        return;
      }

      login(token);
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="bg-surface border border-border rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-lg font-semibold text-text-primary mb-1">Claudemar</h1>
        <p className="text-sm text-text-muted mb-6">Enter your dashboard token to continue.</p>

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
      </div>
    </div>
  );
}
