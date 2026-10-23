export type Requester = { role: "admin" } | { role: "user"; userId: string | null };

// Sem userId, só o admin (token admin, Telegram) chega como "admin" ou sem username;
// identidades sintéticas (pipeline:..., schedule:...) não são de nenhum usuário conhecido.
export function requesterOf(username: string | undefined, userId: string | undefined): Requester {
  if (userId) return { role: "user", userId };
  if (!username || username === "admin") return { role: "admin" };
  return { role: "user", userId: null };
}

export function requesterKey(requester: Requester): string {
  return requester.role === "admin" ? "admin" : `user:${requester.userId ?? ""}`;
}
