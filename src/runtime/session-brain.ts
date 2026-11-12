import { brainExists, brainForRequester, type BrainScope } from "../brain/scope.js";
import { requesterOf } from "../requester.js";
import type { MemoryTarget } from "../memory/session-memory.js";

export interface SessionBrainParams {
  target: MemoryTarget;
  username?: string;
  userId?: string;
}

/**
 * Agentes e o orquestrador recebem o Second Brain de quem abriu a sessão — nunca o de outro usuário do
 * mesmo agente. Identidades sintéticas (pipeline, agendamento sem dono) e brains ainda não criados ficam sem.
 */
export function sessionBrain(params: SessionBrainParams): BrainScope | null {
  if (params.target.targetType !== "agent" && params.target.targetType !== "orchestrator") return null;
  const scope = brainForRequester(requesterOf(params.username, params.userId));
  return scope && brainExists(scope) ? scope : null;
}
