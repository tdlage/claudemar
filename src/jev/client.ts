import { config } from "../config.js";

export type JevState = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: readonly string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

interface JevAnswerByType {
  choice: { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
  score: { type: "score"; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> };
  noul: { type: "noul"; noul: number };
}

export interface JevDecision<Q extends Record<string, JevQuestion>> {
  model: string;
  answers: { [K in keyof Q]: JevAnswerByType[Q[K]["type"]] };
}

export function isJevConfigured(): boolean {
  return config.jevApiKey.length > 0;
}

function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { error, detail } = body as { error?: unknown; detail?: unknown };
  if (typeof error === "string") return error;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return undefined;
}

export async function jevDecide<Q extends Record<string, JevQuestion>>(state: JevState, questions: Q): Promise<JevDecision<Q>> {
  if (!isJevConfigured()) throw new Error("JEV_API_KEY não configurada");
  const res = await fetch(config.jevApiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.jevApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.jevModel, state, questions }),
    signal: AbortSignal.timeout(config.jevTimeoutMs),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Jev respondeu ${res.status}: ${errorMessage(body) ?? res.statusText}`);
  return body as JevDecision<Q>;
}
