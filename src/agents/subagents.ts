import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { buildEmailHint, buildSecretsHint } from "./agent-context.js";
import { getAgentPaths, listAgents, summarizeAgentsMd } from "./manager.js";

function buildDescription(name: string, agentsMd: string): string {
  const summary = summarizeAgentsMd(agentsMd);
  if (!summary) return `Agente ${name}.`;
  return summary.replace(/\*\*/g, "").replace(/\n+/g, " ").trim();
}

function buildPrompt(name: string, agentRoot: string, agentsMd: string): string {
  const persona = agentsMd.trim();
  const workspace = `Seu workspace é ${agentRoot}. Use ${agentRoot}/output para resultados, ${agentRoot}/context para referências e ${agentRoot}/input para entradas. Sempre use caminhos absolutos.`;
  const base = persona ? `${persona}\n\n${workspace}` : `Você é o agente ${name}.\n\n${workspace}`;
  return `${base}${buildSecretsHint(name)}${buildEmailHint()}`;
}

export function buildAgentDefinitions(excludeName?: string, allowList?: string[]): Record<string, AgentDefinition> {
  const allowed = allowList ? new Set(allowList) : null;
  const definitions: Record<string, AgentDefinition> = {};
  for (const name of listAgents()) {
    if (name === excludeName) continue;
    if (allowed && !allowed.has(name)) continue;
    const paths = getAgentPaths(name);
    if (!paths) continue;

    const agentsMdPath = resolve(paths.root, "AGENTS.md");
    let agentsMd = "";
    if (existsSync(agentsMdPath)) {
      try {
        agentsMd = readFileSync(agentsMdPath, "utf-8");
      } catch {
        agentsMd = "";
      }
    }

    definitions[name] = {
      description: buildDescription(name, agentsMd),
      prompt: buildPrompt(name, paths.root, agentsMd),
    };
  }
  return definitions;
}
