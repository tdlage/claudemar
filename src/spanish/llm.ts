import { tmpdir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolveModelSelection } from "../model-routing.js";
import { applyProfile } from "../providers/llm.js";
import { settingsManager } from "../settings-manager.js";

export const SPANISH_MODEL = "claude-opus-5-5";
export const SPANISH_EFFORT = "medium";
const MAX_TURNS = 4;

export interface StructuredRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
}

function sessionEnv(): { env: NodeJS.ProcessEnv; model: string } {
  const { profile, model } = resolveModelSelection(SPANISH_MODEL, settingsManager.get().llmProfiles);
  const env = applyProfile(process.env, profile);
  delete env.CLAUDECODE;
  env.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  return { env, model };
}

export async function generateStructured(request: StructuredRequest): Promise<unknown> {
  const { env, model } = sessionEnv();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), request.timeoutMs);
  try {
    const session = query({
      prompt: request.prompt,
      options: {
        model,
        effort: SPANISH_EFFORT,
        systemPrompt: request.system,
        outputFormat: { type: "json_schema", schema: request.schema },
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        maxTurns: MAX_TURNS,
        cwd: tmpdir(),
        env,
        abortController,
      },
    });
    for await (const message of session) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") throw new Error(`O ${model} não concluiu a resposta (${message.subtype}).`);
      if (message.is_error || message.structured_output === undefined) throw new Error(message.result || `O ${model} não devolveu a resposta estruturada.`);
      return message.structured_output;
    }
    throw new Error(`O ${model} encerrou sem resposta.`);
  } catch (error) {
    if (abortController.signal.aborted) throw new Error(`O ${model} passou do tempo limite de ${Math.round(request.timeoutMs / 1000)} s.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
