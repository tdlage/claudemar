import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { getSocket } from "../../lib/socket";

export function ConnectionStatus() {
  const [state, setState] = useState<
    "connecting" | "connected" | "disconnected"
  >(() => (getSocket().connected ? "connected" : "connecting"));
  useEffect(() => {
    const socket = getSocket();
    const online = () => setState("connected");
    const offline = () => setState("disconnected");
    socket.on("connect", online);
    socket.on("disconnect", offline);
    socket.on("connect_error", offline);
    return () => {
      socket.off("connect", online);
      socket.off("disconnect", offline);
      socket.off("connect_error", offline);
    };
  }, []);
  if (state === "disconnected")
    return (
      <div role="status" className="connection-warning">
        <WifiOff size={16} />
        <span>
          Conexão interrompida. As atualizações serão retomadas ao reconectar.
        </span>
        <button type="button" onClick={() => getSocket().connect()}>
          Reconectar
        </button>
      </div>
    );
  return null;
}
