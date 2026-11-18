import type { ErrorRequestHandler } from "express";
import { formatSize } from "../byte-utils.js";

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  expose?: boolean;
  type?: string;
  limit?: number;
  length?: number;
  received?: number;
}

export const httpErrorHandler: ErrorRequestHandler = (err: HttpError, req, res, _next) => {
  if (err.type === "entity.too.large" && typeof err.limit === "number") {
    const size = err.length ?? err.received;
    console.warn(`[server] ${req.method} ${req.originalUrl}: corpo${size ? ` de ${formatSize(size)}` : ""} excede o limite de ${formatSize(err.limit)}`);
    res.status(413).json({ error: size
      ? `O envio tem ${formatSize(size)} e o limite do servidor é ${formatSize(err.limit)}.`
      : `O envio excede o limite de ${formatSize(err.limit)} do servidor.` });
    return;
  }
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 400 && status < 500 && err.expose) {
    res.status(status).json({ error: err.message });
    return;
  }
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
};
