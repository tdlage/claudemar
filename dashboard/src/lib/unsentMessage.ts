export function unsentMessage(error: unknown): string {
  const reason = (error instanceof Error ? error.message : String(error)).replace(/\.$/, "");
  return `Mensagem não enviada: ${reason}. O texto e os anexos continuam no campo.`;
}
