const AUTH_ERROR_PATTERN = /\b401\b|unauthorized|not logged in|login required|run `?codex login|authentication|invalid[_ ]token|token (has )?expired/i;

let lastAuthError: { at: number; message: string } | null = null;

export function looksLikeCodexAuthError(message: string): boolean {
  return Boolean(message) && AUTH_ERROR_PATTERN.test(message);
}

// Sinaliza que uma execução do runtime Codex falhou por autenticação (login do ChatGPT
// expirado/revogado). A seção "Conta OpenAI" do dashboard consulta este estado.
export function noteCodexFailure(message: string): void {
  if (looksLikeCodexAuthError(message)) {
    lastAuthError = { at: Date.now(), message: message.slice(0, 300) };
  }
}

export function noteCodexSuccess(): void {
  lastAuthError = null;
}

export function getLastCodexAuthError(): { at: number; message: string } | null {
  return lastAuthError;
}

export function clearLastCodexAuthError(): void {
  lastAuthError = null;
}
