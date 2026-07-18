import { executionManager } from "../execution-manager.js";

// Sinaliza que uma execução falhou por autenticação (subscription do Claude expirada/revogada,
// tipicamente HTTP 401 quando o refresh_token também falha). O banner do dashboard consulta este
// estado para oferecer o re-login. Uma execução bem-sucedida limpa o sinal.
const AUTH_ERROR_PATTERN = /\b401\b|unauthorized|authentication_error|invalid[_ ]grant|oauth\b|token (has )?expired|run \/login|please log ?in|credentials?.*(expired|invalid)/i;

let lastAuthError: { at: number; message: string } | null = null;

function looksLikeAuthError(message: string): boolean {
  return Boolean(message) && AUTH_ERROR_PATTERN.test(message);
}

export function initClaudeAuthWatch(): void {
  executionManager.on("error", (_id: string, _info: unknown, message: string) => {
    if (looksLikeAuthError(String(message ?? ""))) {
      lastAuthError = { at: Date.now(), message: String(message).slice(0, 300) };
    }
  });
  executionManager.on("complete", () => {
    lastAuthError = null;
  });
}

export function getLastAuthError(): { at: number; message: string } | null {
  return lastAuthError;
}

export function clearLastAuthError(): void {
  lastAuthError = null;
}
