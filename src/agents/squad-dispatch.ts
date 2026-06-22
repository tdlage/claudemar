import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { executionManager } from "../execution-manager.js";
import { getAgentPaths, extractAgentSummary, readAgentsMd } from "./manager.js";
import { listTeamMembers, getTeam, teamEvents } from "./teams-manager.js";

export interface DispatchResult {
  agent: string;
  execId: string;
}

export async function dispatchToSquad(teamId: string, prompt: string, username?: string, preferredAgent?: string): Promise<DispatchResult> {
  const team = await getTeam(teamId);
  if (!team) throw new Error("Squad não encontrado");
  const members = await listTeamMembers(teamId);
  if (members.length === 0) throw new Error("Squad sem agentes");

  const names = members.map((m) => m.agentName);
  const lead = members.find((m) => m.role === "lead")?.agentName ?? names[0];
  const chosen = preferredAgent && names.includes(preferredAgent)
    ? preferredAgent
    : names.length === 1
      ? names[0]
      : (await classify(prompt, names)) ?? lead;

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
const PERSONA_MAX_CHARS = 1500;

function agentBrief(name: string): string {
  const md = readAgentsMd(name);
  if (md) return md.length > PERSONA_MAX_CHARS ? `${md.slice(0, PERSONA_MAX_CHARS)}…` : md;
  return extractAgentSummary(name) ?? "Sem descrição disponível.";
}

async function classify(prompt: string, names: string[]): Promise<string | null> {
  const roster = names
    .map((n) => `<agente nome="${n}">\n${agentBrief(n)}\n</agente>`)
    .join("\n\n");
  const instruction =
    "Você é o presidente de um squad de agentes e atua como roteador. Cada agente abaixo tem uma especialidade descrita na sua persona (AGENTS.md). " +
    "Leia o pedido do usuário, compare com as responsabilidades de cada agente e escolha o ÚNICO agente mais adequado para executá-lo.\n\n" +
    `Agentes disponíveis:\n${roster}\n\n` +
    "Responda SOMENTE com o nome exato (atributo nome) de um dos agentes acima, sem nenhuma outra palavra, pontuação ou explicação.";

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
