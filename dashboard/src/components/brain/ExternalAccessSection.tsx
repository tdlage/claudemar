import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { useBrainData } from "../../hooks/useBrain";
import type { BrainApiKey, BrainApiKeysResponse, BrainMcpAuditEntry } from "../../lib/types";

const inputClass =
  "flex-1 bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={title}
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1.5 rounded text-text-muted hover:bg-accent/10 transition-colors shrink-0"
    >
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
    </button>
  );
}

export function ExternalAccessSection() {
  const { addToast } = useToast();
  const { data, setData, loading, error } = useBrainData<BrainApiKeysResponse>("/brain/api-keys");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ key: string; info: BrainApiKey } | null>(null);
  const [busy, setBusy] = useState(false);
  const audit = useBrainData<BrainMcpAuditEntry[]>("/brain/api-keys/audit?limit=30");

  const endpoint = `${data?.publicBaseUrl || window.location.origin}${data?.endpointPath ?? "/api/brain/mcp"}`;

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ key: string; info: BrainApiKey }>("/brain/api-keys", { name });
      setCreated(result);
      setName("");
      setData((prev) => (prev ? { ...prev, keys: [...prev.keys, result.info] } : prev));
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: BrainApiKey) => {
    if (!confirm(`Revogar a chave "${key.name}"? Quem a usa perde o acesso na hora.`)) return;
    try {
      await api.delete(`/brain/api-keys/${key.id}`);
      setData((prev) => (prev ? { ...prev, keys: prev.keys.filter((k) => k.id !== key.id) } : prev));
      if (created?.info.id === key.id) setCreated(null);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const xaiTool = created
    ? JSON.stringify(
        { type: "mcp", server_url: endpoint, server_label: "second_brain", authorization: created.key },
        null,
        2,
      )
    : "";

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Servidor MCP (Streamable HTTP, sem estado) para agentes externos, como o Grok pela API da xAI. As ferramentas
        são só de leitura e enxergam o Brain inteiro — todos os canais, inclusive conteúdo com dados pessoais. O que for
        consultado é enviado ao provedor do agente.
      </p>
      <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
        <span className="text-xs text-text-muted shrink-0">Endpoint</span>
        <code className="text-xs text-text-primary truncate flex-1">{endpoint}</code>
        <CopyButton value={endpoint} title="Copiar endpoint" />
      </div>

      {loading && !data && <p className="text-xs text-text-muted">Carregando…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      {data && data.keys.length > 0 && (
        <div className="divide-y divide-border border border-border rounded-md">
          {data.keys.map((key) => (
            <div key={key.id} className="flex items-center gap-2 px-3 py-2">
              <KeyRound size={13} className="text-text-muted shrink-0" />
              <span className="text-sm text-text-primary flex-1 truncate">{key.name}</span>
              <code className="text-xs text-text-muted">{key.prefix}…</code>
              <span className="text-xs text-text-muted">
                {key.lastUsedAt
                  ? `usada ${formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}`
                  : "nunca usada"}
              </span>
              <button
                title="Revogar"
                onClick={() => revoke(key)}
                className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da chave" className={inputClass} />
        <Button size="sm" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Gerando…" : "Gerar chave"}
        </Button>
      </div>

      {(audit.data ?? []).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-text-muted">Últimos acessos</p>
          <div className="max-h-56 overflow-y-auto divide-y divide-border border border-border rounded-md">
            {(audit.data ?? []).map((entry, i) => (
              <div key={`${entry.at}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="text-text-muted shrink-0">
                  {formatDistanceToNow(new Date(entry.at), { addSuffix: true })}
                </span>
                <span className={entry.ok ? "text-text-primary" : "text-danger"}>{entry.tool}</span>
                <code className="text-text-muted truncate flex-1" title={entry.args}>
                  {entry.args}
                </code>
                <span className="text-text-muted shrink-0">
                  {entry.keyName} · {entry.ip}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {created && (
        <div className="bg-warning/10 border border-warning/30 rounded-md p-3 space-y-2">
          <p className="text-xs text-warning font-semibold">
            Copie agora: a chave "{created.info.name}" não será mostrada de novo.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-text-primary break-all flex-1">{created.key}</code>
            <CopyButton value={created.key} title="Copiar chave" />
          </div>
          <p className="text-xs text-text-muted">Ferramenta MCP para a API da xAI (Responses API, campo tools):</p>
          <div className="flex items-start gap-2">
            <pre className="text-[11px] text-text-secondary bg-bg border border-border rounded-md p-2 flex-1 overflow-x-auto">{xaiTool}</pre>
            <CopyButton value={xaiTool} title="Copiar configuração" />
          </div>
        </div>
      )}
    </div>
  );
}
