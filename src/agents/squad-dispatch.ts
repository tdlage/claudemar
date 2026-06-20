import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { executionManager } from "../execution-manager.js";
import { getAgentPaths, extractAgentSummary } from "./manager.js";
import { listTeamMembers, getTeam, teamEvents } from "./teams-manager.js";

export interface DispatchResult {
  agent: string;
  execId: string;
}

export async function dispatchToSquad(teamId: string, prompt: string, username?: string): Promise<DispatchResult> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Squad não encontrado");
  const members = await listTeamMembers(teamId);
  if (members.length === 0) throw new Error("Squad sem agentes");

  const names = members.map((m) => m.agentName);
  const lead = members.find((m) => m.role === "lead")?.agentName ?? names[0];
  const chosen = names.length === 1 ? names[0] : (await classify(prompt, names)) ?? lead;

  const paths = getAgentPaths(chosen);
  if (!paths) throw new Error("Agente inválido");

  const execId = executionManager.startExecution({
    source: "web",
    targetType: "agent",
    targetName: chosen,
    prompt,
    cwd: paths.root,
    username,
  });

  teamEvents.emit("dispatch", { teamId, agent: chosen, execId });
  return { agent: chosen, execId };
}

const CLASSIFY_TIMEOUT_MS = 30_000;

async function classify(prompt: string, names: string[]): Promise<string | null> {
  const roster = names
    .map((n) => `- ${n}: ${extractAgentSummary(n) ?? "agente do squad"}`)
    .join("\n");
  const instruction =
    "Você é o presidente de um squad de agentes. Dado o pedido do usuário, escolha qual UM agente é o mais adequado para executá-lo. " +
    `Agentes disponíveis:\n${roster}\n\n` +
    "Responda SOMENTE com o nome exato de um dos agentes acima, sem nenhuma outra palavra, pontuação ou explicação.";

  const abortController = new AbortController();
  const options: Options = {
    model: "opus",
    cwd: config.orchestratorPath,
    maxTurns: 1,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
    systemPrompt: { type: "preset", preset: "claude_code", append: instruction },
  };

  const timer = setTimeout(() => abortController.abort(), CLASSIFY_TIMEOUT_MS);
  try {
    let result = "";
    for await (const msg of query({ prompt: `Pedido: ${prompt}`, options })) {
      if (msg.type === "result" && msg.subtype === "success") result = msg.result ?? "";
    }
    return matchAgent(result, names);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function matchAgent(raw: string, names: string[]): string | null {
  const answer = raw.trim();
  const exact = names.find((n) => n === answer);
  if (exact) return exact;
  const byToken = names.filter((n) => new RegExp(`(^|[^a-zA-Z0-9.-])${escapeRegExp(n)}([^a-zA-Z0-9.-]|$)`).test(answer));
  if (byToken.length === 1) return byToken[0];
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
