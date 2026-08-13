import { useEffect, useRef, useState } from "react";
import { MessageCircle, Hash, QrCode, Upload, CheckCircle2, XCircle, Play } from "lucide-react";
import { api } from "../../lib/api";
import { Badge } from "../shared/Badge";
import { Button } from "../shared/Button";
import { Modal } from "../shared/Modal";
import { useToast } from "../shared/Toast";


interface BridgeStatus {
  reachable: boolean;
  connected: boolean;
  loggedIn: boolean;
  detail: string;
}

interface EnvKeyStatus {
  key: string;
  present: boolean;
}

export function WhatsappSlackSection() {
  const { addToast } = useToast();
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [envKeys, setEnvKeys] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<BridgeStatus>("/brain/whatsapp/status").then(setBridge).catch(() => {});
    api
      .get<EnvKeyStatus[]>("/system/env")
      .then((keys) => {
        const map: Record<string, boolean> = {};
        for (const k of keys) map[k.key] = k.present;
        setEnvKeys(map);
      })
      .catch(() => {});
  }, []);

  const startBridge = async () => {
    setStarting(true);
    try {
      const status = await api.post<BridgeStatus>("/brain/whatsapp/start", {});
      setBridge(status);
      addToast(
        status.reachable ? "success" : "error",
        status.reachable
          ? status.loggedIn
            ? "Container no ar e sessão ativa"
            : "Container no ar — escaneie o QR para parear"
          : `Container subiu mas segue inacessível: ${status.detail}`,
      );
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const showQr = async () => {
    setBusy(true);
    try {
      const res = await api.get<{ dataUri: string }>("/brain/whatsapp/qr");
      setQr(res.dataUri);
      setQrOpen(true);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const content = await file.text();
      const res = await api.post<{ parsed: number; emitted: number; threads: number }>("/brain/whatsapp/import", {
        filename: file.name,
        content,
      });
      addToast(
        "success",
        `Import concluído: ${res.parsed} mensagem(ns), ${res.emitted} nova(s), ${res.threads} thread(s)`,
      );
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-bg border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <MessageCircle size={15} className="text-text-muted" />
          <span className="text-sm font-medium text-text-primary flex-1">WhatsApp (bridge — número secundário)</span>
          {bridge &&
            (bridge.loggedIn ? (
              <Badge variant="success">sessão ativa</Badge>
            ) : bridge.reachable ? (
              <Badge variant="warning">sem sessão — escaneie o QR</Badge>
            ) : (
              <Badge variant="danger">container fora do ar</Badge>
            ))}
        </div>
        <p className="text-xs text-text-muted">
          Bridge não oficial (whatsmeow) em container — use SEMPRE um número secundário; risco de banimento pela
          Meta. Mídia não é persistida.
        </p>
        {bridge && !bridge.reachable && (
          <p className="text-xs text-warning">
            O container <span className="font-mono">claudemar-whatsapp</span> não está no ar — nada escuta em{" "}
            <span className="font-mono">127.0.0.1:3010</span>. Use "Iniciar container" abaixo (equivale a{" "}
            <span className="font-mono">docker compose up -d whatsapp-bridge</span>).
          </p>
        )}
        {envKeys["BRAIN_WHATSAPP_WEBHOOK_SECRET"] === false && (
          <p className="text-xs text-warning">
            BRAIN_WHATSAPP_WEBHOOK_SECRET ausente — sem ele o webhook rejeita tudo e o scheduler fica desligado.
            Defina em Settings → Variáveis de ambiente.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={startBridge}
            disabled={starting}
            className="flex items-center gap-1.5"
          >
            <Play size={14} />
            {starting ? "Subindo…" : "Iniciar container"}
          </Button>
          <Button size="sm" variant="secondary" onClick={showQr} disabled={busy} className="flex items-center gap-1.5">
            <QrCode size={14} />
            {busy ? "Buscando…" : "Mostrar QR de pareamento"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5"
          >
            <Upload size={14} />
            {importing ? "Importando…" : "Importar export (.txt)"}
          </Button>
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
        <p className="text-[10px] text-text-muted">
          O histórico completo entra pelo export nativo por conversa (WhatsApp → Conversa → Exportar conversa, sem
          mídia). O sync ao vivo cobre apenas mensagens novas.
        </p>
      </div>

      <div className="bg-bg border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Hash size={15} className="text-text-muted" />
          <span className="text-sm font-medium text-text-primary flex-1">Slack (Socket Mode)</span>
          {["SLACK_APP_TOKEN", "SLACK_BOT_TOKEN"].map((key) =>
            envKeys[key] === undefined ? null : envKeys[key] ? (
              <span key={key} title={`${key} presente`}>
                <CheckCircle2 size={14} className="text-success" />
              </span>
            ) : (
              <span key={key} title={`${key} ausente — defina em Settings → Variáveis de ambiente`}>
                <XCircle size={14} className="text-warning" />
              </span>
            ),
          )}
        </div>
        <p className="text-xs text-text-muted">
          Crie um app Slack com Socket Mode (token xapp-) e um bot (token xoxb-) com escopos channels:history,
          groups:history, im:history, users:read e channels:read. Convide o bot nos canais que devem ser ingeridos.
          Sem endpoint público — a conexão sai daqui para o Slack.
        </p>
      </div>

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Parear WhatsApp">
        <div className="space-y-3 text-center">
          {qr ? (
            <img src={qr} alt="QR de pareamento do WhatsApp" className="mx-auto w-64 h-64 bg-white p-2 rounded" />
          ) : (
            <p className="text-sm text-text-muted">QR indisponível.</p>
          )}
          <p className="text-xs text-text-muted">
            No celular (número secundário): WhatsApp → Aparelhos conectados → Conectar aparelho.
          </p>
        </div>
      </Modal>
    </div>
  );
}
