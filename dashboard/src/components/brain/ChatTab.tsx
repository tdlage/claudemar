import { useEffect, useRef, useState } from "react";
import { Send, Wrench, Trash2 } from "lucide-react";
import { Button } from "../shared/Button";
import { useToast } from "../shared/Toast";
import { api } from "../../lib/api";
import type { BrainChatMessage, BrainChatResponse } from "../../lib/types";

const STORAGE_KEY = "brain_chat_history";

const SUGESTOES = [
  "O que chegou de mais importante esta semana?",
  "Tenho algum prazo ou compromisso em aberto?",
  "Resuma o que sei sobre a contabilidade",
];

function loadHistory(): BrainChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as BrainChatMessage[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ChatTab() {
  const { addToast } = useToast();
  const [messages, setMessages] = useState<BrainChatMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastTools, setLastTools] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: BrainChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setLastTools([]);
    try {
      const res = await api.post<BrainChatResponse>("/brain/chat", { messages: next });
      setMessages([...next, { role: "assistant", content: res.reply }]);
      setLastTools(res.toolCalls.map((t) => t.name));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addToast("error", message);
      setMessages([...next, { role: "assistant", content: `Falhou: ${message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-16rem)] min-h-[28rem]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <div className="text-sm text-text-muted space-y-3 py-6">
            <p>
              Pergunte qualquer coisa sobre o que já foi ingerido. A resposta é montada consultando o wiki
              compilado e, quando ele não basta, a evidência bruta dos canais — sempre citando de onde veio.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="text-xs border border-border rounded-md px-2 py-1 text-text-secondary hover:border-accent hover:text-accent transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={`${i}-${m.content.slice(0, 24)}`}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-accent/15 border border-accent/30 text-text-primary"
                  : "bg-bg border border-border text-text-secondary"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-muted">
              consultando o brain…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {lastTools.length > 0 && !busy && (
        <p className="text-[11px] text-text-muted flex items-center gap-1.5 pt-2">
          <Wrench size={11} />
          consultou: {lastTools.join(" · ")}
        </p>
      )}

      <div className="flex items-end gap-2 pt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Pergunte ao seu Second Brain… (Enter envia, Shift+Enter quebra linha)"
          className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
        />
        <Button onClick={() => void send(input)} disabled={busy || !input.trim()} className="flex items-center gap-1.5">
          <Send size={14} />
          Enviar
        </Button>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setMessages([]);
              setLastTools([]);
            }}
            disabled={busy}
            title="Limpar conversa"
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
