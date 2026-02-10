import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

function createSocket(): Socket {
  const token = localStorage.getItem("dashboard_token") || "";
  const s = io({
    auth: { token },
    transports: ["websocket", "polling"],
  });

  s.on("auth:expired", () => {
    localStorage.removeItem("dashboard_token");
    window.location.href = "/login";
  });

  s.on("connect_error", (err) => {
    if (err.message === "Unauthorized") {
      localStorage.removeItem("dashboard_token");
      window.location.href = "/login";
    }
  });

  return s;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function reconnectSocket(): void {
  disconnectSocket();
  socket = createSocket();
}
