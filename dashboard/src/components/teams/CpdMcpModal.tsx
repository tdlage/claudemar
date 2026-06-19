import { useEffect, useState, useCallback } from "react";
import { Trash2, Plus, Server } from "lucide-react";
import { Modal } from "../shared/Modal";
import { api } from "../../lib/api";

interface SquadMcp { id: string; name: string; config: { type?: string; command?: string; url?: string } }
type McpType = "stdio" | "http" | "sse";

function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function CpdMcpModal({ teamId, teamName, open, onClose }: { teamId: string; teamName: string; open: boolean; onClose: () => void }) {
  const [mcps, setMcps] = useState<SquadMcp[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<McpType>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [kv, setKv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!open) return;
    api.get<SquadMcp[]>(`/teams/${teamId}/mcps`).then(setMcps).catch(() => setMcps([]));
  }, [open, teamId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError(null);
    const config = type === "stdio"
      ? { type, command: command.trim(), args: args.split(",").map((a) => a.trim()).filter(Boolean), env: parseKv(kv) }
      : { type, url: url.trim(), headers: parseKv(kv) };
    try {
      await api.post(`/teams/${teamId}/mcps`, { name: name.trim(), config });
      setName(""); setCommand(""); setArgs(""); setUrl(""); setKv("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha");
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => { await api.delete(`/teams/${teamId}/mcps/${id}`).catch(() => {}); load(); };

  return (
    <Modal open={open} onClose={onClose} title={`CPD · MCPs do ${teamName}`} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-text-muted">Servidores MCP adicionados aqui ficam disponíveis a todos os agentes deste squad (injetados na sessão do Agent SDK).</p>

        <div className="space-y-1.5">
          {mcps.map((m) => (
            <div key={m.id} className="flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2">
              <Server size={14} className="text-accent shrink-0" />
              <span className="text-sm text-text-primary">{m.name}</span>
              <span className="text-xs text-text-muted truncate">{m.config.type ?? "stdio"} · {m.config.command ?? m.config.url}</span>
              <button onClick={() => remove(m.id)} className="ml-auto p-1 rounded text-text-muted hover:text-danger transition-colors"><Trash2 size={14} /></button>
            </div>
          ))}
          {mcps.length === 0 && <p className="text-sm text-text-muted">Nenhum MCP configurado.</p>}
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nome (ex: github)" className="flex-1 bg-bg border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
            <select value={type} onChange={(e) => setType(e.target.value as McpType)} className="bg-bg border border-border rounded-md px-2 text-sm focus:outline-none focus:border-accent">
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </div>
          {type === "stdio" ? (
            <>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command (ex: npx)" className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
              <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="args separados por vírgula (ex: -y, @modelcontextprotocol/server-github)" className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
            </>
          ) : (
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="url (ex: https://...)" className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
          )}
          <textarea value={kv} onChange={(e) => setKv(e.target.value)} rows={2} placeholder={type === "stdio" ? "env (KEY=VALUE por linha)" : "headers (KEY=VALUE por linha)"} className="w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent resize-none" />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end">
            <button onClick={add} disabled={!name.trim() || saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:pointer-events-none transition-colors">
              <Plus size={13} /> Adicionar MCP
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
