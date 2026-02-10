import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { spawnClaude } from "../executor.js";
import { listAgents, getAgentPaths } from "./manager.js";
import { routeOrchestratorMessages } from "./messenger.js";

function readAgentContext(agentName: string): string {
  const paths = getAgentPaths(agentName);
  if (!paths || !existsSync(paths.root)) return "";

  const sections: string[] = [`## Agente: ${agentName}`];

  const claudeMdPath = resolve(paths.root, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf-8");
    sections.push(`### CLAUDE.md\n${content}`);
  }

  if (existsSync(paths.context)) {
    const contextFiles = readdirSync(paths.context);
    for (const file of contextFiles) {
      const filePath = resolve(paths.context, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const preview = lines.slice(0, 50).join("\n");
        const truncated = lines.length > 50 ? "\n[... truncado]" : "";
        sections.push(`### context/${file}\n${preview}${truncated}`);
      } catch {
        // skip unreadable files
      }
    }
  }

  return sections.join("\n\n");
}

export async function runCouncil(topic: string, chatId: number): Promise<string> {
  const agents = listAgents();

  if (agents.length === 0) {
    return "Nenhum agente encontrado. Crie agentes primeiro com /agent create <nome>.";
  }

  const agentContexts = agents.map(readAgentContext).filter(Boolean).join("\n\n---\n\n");

  const prompt = `${agentContexts}

---

TEMA DO COUNCIL: ${topic}

Instrução: Simule uma reunião entre os agentes relevantes sobre o tema acima.
Cada agente deve defender sua perspectiva baseado no contexto fornecido.
Produza: 1) Ata da reunião 2) Decisões 3) Action items por agente

Para cada action item, crie um arquivo em ./outbox/ seguindo o formato:
PARA-<agente>_${new Date().toISOString().replace(/[:.]/g, "-")}_<assunto>.md

O conteúdo de cada arquivo deve ser a tarefa detalhada para o agente.`;

  const handle = spawnClaude(prompt, config.orchestratorPath);
  const result = await handle.promise;

  const routeResult = routeOrchestratorMessages();

  const sharedDir = resolve(config.orchestratorPath, "shared");
  mkdirSync(sharedDir, { recursive: true });

  const logPath = resolve(sharedDir, "decisions-log.md");
  const logEntry = `\n\n---\n## Council: ${topic}\n**Data:** ${new Date().toISOString()}\n\n${result.output}\n`;
  appendFileSync(logPath, logEntry, "utf-8");

  let output = result.output;
  if (routeResult.routed > 0) {
    output += `\n\n📨 ${routeResult.routed} mensagem(ns) roteada(s) para agentes.`;
  }
  if (routeResult.errors.length > 0) {
    output += `\n\n⚠️ Erros: ${routeResult.errors.join(", ")}`;
  }

  return output;
}
