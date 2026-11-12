import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, QrCode, Upload, Play, Unplug, Users, User, X, ListChecks } from "lucide-react";
import { api } from "../../lib/api";
import { isAdmin } from "../../hooks/useAuth";
import { useDebounce } from "../../hooks/useDebounce";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";
import type { BrainWhatsappChat, BrainWhatsappChatOption, BrainWhatsappStatus } from "../../lib/types";

const QR_POLL_MS = 3000;

const inputClass =
  "w-full bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent";

function ChatIcon({ kind }: { kind: BrainWhatsappChat["kind"] }) {
  return kind === "group" ? <Users size={13} className="text-text-muted shrink-0" /> : <User size={13} className="text-text-muted shrink-0" />;
}

function ChatPicker({
  open,
  selected,
  onClose,
  onSaved,
}: {
  open: boolean;
  selected: BrainWhatsappChat[];
  onClose: () => void;
  onSaved: (chats: BrainWhatsappChat[]) => void;
}) {
  const { addToast } = useToast();
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [options, setOptions] = useState<BrainWhatsappChatOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Map<string, BrainWhatsappChat>>(new Map());
  const [saving, setSaving] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (open) setDraft(new Map(selected.map((chat) => [chat.jid, chat])));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    api
      .get<BrainWhatsappChatOption[]>(`/brain/whatsapp/chats?search=${encodeURIComponent(debounced)}`)
      .then((list) => {
        if (seq === requestSeq.current) setOptions(list);
      })
      .catch((e) => {
        if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [open, debounced]);

  const toggle = (chat: BrainWhatsappChat) => {
    setDraft((prev) => {
      const next = new Map(prev);
      if (next.has(chat.jid)) next.delete(chat.jid);
      else next.set(chat.jid, { jid: chat.jid, name: chat.name, kind: chat.kind });
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const chats = await api.put<BrainWhatsappChat[]>("/brain/whatsapp/selection", { chats: [...draft.values()] });
      onSaved(chats);
      addToast("success", `${chats.length} conversa(s) selecionada(s) para sincronizar`);
      onClose();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const draftOnly = [...draft.values()].filter((chat) => !options.some((option) => option.jid === chat.jid));

  return (
    <Modal open={open} onClose={onClose} title="Conversas do WhatsApp a sincronizar" size="lg">
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          Só as conversas marcadas entram no seu brain. Mensagens de contatos e grupos fora da seleção são descartadas
          ao chegar (nem as notas de voz são transcritas).
        </p>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar contato ou grupo"
          className={inputClass}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-border border border-border rounded-md">
          {draftOnly.map((chat) => (
            <label key={chat.jid} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/5">
              <input type="checkbox" checked onChange={() => toggle(chat)} />
              <ChatIcon kind={chat.kind} />
              <span className="text-sm text-text-primary truncate flex-1">{chat.name}</span>
              <span className="text-[10px] text-text-muted font-mono">{chat.jid.split("@")[0]}</span>
            </label>
          ))}
          {options.map((option) => (
            <label key={option.jid} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/5">
              <input type="checkbox" checked={draft.has(option.jid)} onChange={() => toggle(option)} />
              <ChatIcon kind={option.kind} />
              <span className="text-sm text-text-primary truncate flex-1">{option.name}</span>
              <span className="text-[10px] text-text-muted font-mono">{option.jid.split("@")[0]}</span>
            </label>
          ))}
          {!loading && options.length === 0 && draftOnly.length === 0 && (
            <p className="text-xs text-text-muted px-3 py-4 text-center">Nenhuma conversa encontrada.</p>
          )}
          {loading && <p className="text-xs text-text-muted px-3 py-2">Carregando…</p>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted">{draft.size} selecionada(s)</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Salvando…" : "Salvar seleção"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function WhatsappSection() {
  const { addToast } = useToast();
  const admin = isAdmin();
  const [status, setStatus] = useState<BrainWhatsappStatus | null>(null);
  const [selected, setSelected] = useState<BrainWhatsappChat[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState<"qr" | "start" | "import" | "disconnect" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api.get<BrainWhatsappStatus>("/brain/whatsapp/status").then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    api.get<BrainWhatsappChat[]>("/brain/whatsapp/selection").then(setSelected).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!qrOpen) return;
    const id = setInterval(() => {
      api
        .get<BrainWhatsappStatus>("/brain/whatsapp/status")
        .then((next) => {
          setStatus(next);
          if (next.loggedIn) {
            setQrOpen(false);
            addToast("success", admin ? "WhatsApp pareado" : "WhatsApp pareado — agora escolha as conversas a sincronizar");
          }
        })
        .catch(() => {});
    }, QR_POLL_MS);
    return () => clearInterval(id);
  }, [qrOpen, addToast, admin]);

  const showQr = async () => {
    setBusy("qr");
    try {
      const res = await api.get<{ dataUri: string }>("/brain/whatsapp/qr");
      setQr(res.dataUri);
      setQrOpen(true);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const startBridge = async () => {
    setBusy("start");
    try {
      const next = await api.post<BrainWhatsappStatus>("/brain/whatsapp/start", {});
      setStatus((prev) => (prev ? { ...prev, ...next } : prev));
      addToast(next.reachable ? "success" : "error", next.reachable ? "Container no ar" : `Container segue inacessível: ${next.detail}`);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      const next = await api.post<BrainWhatsappStatus>("/brain/whatsapp/disconnect", {});
      setStatus((prev) => (prev ? { ...prev, ...next } : prev));
      addToast("success", "WhatsApp desconectado deste brain");
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setConfirmDisconnect(false);
    }
  };

  const removeChat = async (jid: string) => {
    try {
      setSelected(await api.put<BrainWhatsappChat[]>("/brain/whatsapp/selection", { chats: selected.filter((c) => c.jid !== jid) }));
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const importFile = async (file: File) => {
    setBusy("import");
    try {
      const content = await file.text();
      const res = await api.post<{ parsed: number; emitted: number; threads: number }>("/brain/whatsapp/import", {
        filename: file.name,
        content,
      });
      addToast("success", `Import concluído: ${res.parsed} mensagem(ns), ${res.emitted} nova(s), ${res.threads} thread(s)`);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const active = Boolean(status?.paired && status.loggedIn);

  return (
    <div className="bg-bg border border-border rounded-md p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <MessageCircle size={15} className="text-text-muted" />
        <span className="text-sm font-medium text-text-primary flex-1">WhatsApp</span>
        {status &&
          (!status.reachable ? (
            <Badge variant="danger">bridge fora do ar</Badge>
          ) : active ? (
            <Badge variant="success">sessão ativa</Badge>
          ) : status.paired ? (
            <Badge variant="warning">sessão desconectada</Badge>
          ) : (
            <Badge>não pareado</Badge>
          ))}
      </div>
      <p className="text-xs text-text-muted">
        Pareie o seu número (de preferência um secundário — o bridge não é oficial e há risco de banimento pela Meta).
        Cada usuário pareia o próprio número.{" "}
        {admin
          ? "No seu brain entram todas as conversas do número pareado."
          : "Só as conversas escolhidas entram no seu brain."}{" "}
        Mídia não é persistida.
      </p>
      {status && !status.webhookConfigured && (
        <p className="text-xs text-warning">
          {admin
            ? "BRAIN_WHATSAPP_WEBHOOK_SECRET ausente — sem ele o webhook rejeita tudo. Defina em Settings → Variáveis de ambiente."
            : "O administrador ainda não habilitou o WhatsApp no servidor."}
        </p>
      )}
      {status && !status.reachable && (
        <p className="text-xs text-warning">
          {admin ? (
            <>
              O container <span className="font-mono">claudemar-whatsapp</span> não está no ar. Use "Iniciar container"
              (equivale a <span className="font-mono">docker compose up -d whatsapp-bridge</span>).
            </>
          ) : (
            "O bridge do WhatsApp está fora do ar — avise o administrador."
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {admin && status && !status.reachable && (
          <Button size="sm" variant="secondary" onClick={startBridge} disabled={busy !== null} className="flex items-center gap-1.5">
            <Play size={14} />
            {busy === "start" ? "Subindo…" : "Iniciar container"}
          </Button>
        )}
        {status?.reachable && !active && (
          <Button size="sm" variant="secondary" onClick={showQr} disabled={busy !== null} className="flex items-center gap-1.5">
            <QrCode size={14} />
            {busy === "qr" ? "Buscando…" : status.paired ? "Mostrar QR de pareamento" : "Parear meu número"}
          </Button>
        )}
        {active && !admin && (
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)} className="flex items-center gap-1.5">
            <ListChecks size={14} />
            Escolher conversas
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          className="flex items-center gap-1.5"
        >
          <Upload size={14} />
          {busy === "import" ? "Importando…" : "Importar export (.txt)"}
        </Button>
        {status?.paired && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null} className="flex items-center gap-1.5">
            <Unplug size={14} />
            Desconectar
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </div>

      {status?.paired && !admin && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <p className="text-xs font-medium text-text-muted">Conversas sincronizadas ({selected.length})</p>
          {selected.length === 0 ? (
            <p className="text-xs text-warning">
              Nenhuma conversa selecionada — nada do WhatsApp entra no brain até você escolher contatos ou grupos.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((chat) => (
                <span
                  key={chat.jid}
                  className="inline-flex items-center gap-1 bg-surface border border-border rounded-full pl-2 pr-1 py-0.5 text-xs text-text-secondary"
                  title={chat.jid}
                >
                  <ChatIcon kind={chat.kind} />
                  {chat.name}
                  <button
                    onClick={() => void removeChat(chat.jid)}
                    className="p-0.5 rounded-full text-text-muted hover:text-danger"
                    aria-label={`Parar de sincronizar ${chat.name}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-text-muted">
        O histórico antigo entra pelo export nativo por conversa (WhatsApp → Conversa → Exportar conversa, sem mídia); o
        import não depende da seleção. O sync ao vivo cobre apenas mensagens novas
        {admin ? " de todas as conversas." : " das conversas selecionadas."}
      </p>

      {!admin && <ChatPicker open={pickerOpen} selected={selected} onClose={() => setPickerOpen(false)} onSaved={setSelected} />}

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Parear WhatsApp">
        <div className="space-y-3 text-center">
          {qr ? (
            <img src={qr} alt="QR de pareamento do WhatsApp" className="mx-auto w-64 h-64 bg-white p-2 rounded" />
          ) : (
            <p className="text-sm text-text-muted">QR indisponível.</p>
          )}
          <p className="text-xs text-text-muted">No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
          <Button size="sm" variant="ghost" onClick={showQr} disabled={busy !== null}>
            Gerar outro QR
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Desconectar WhatsApp">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            O número sai do bridge e as mensagens novas param de chegar ao seu brain. O que já foi gravado permanece.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={disconnect} disabled={busy !== null}>
              Desconectar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
