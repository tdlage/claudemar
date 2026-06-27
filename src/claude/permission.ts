import type { PermissionMode, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

export type ExecutionSourceLike = "telegram" | "web" | "schedule" | "pipeline";

export interface BypassInput {
  source: ExecutionSourceLike;
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
  planMode?: boolean;
}

// O pipeline roda sem supervisão: é sempre bypass (auto mode), independente de o caller passar
// autoApprove. planMode tem precedência e nunca auto-aprova.
export function resolveBypass(opts: BypassInput): boolean {
  if (opts.planMode) return false;
  if (opts.source === "pipeline") return true;
  const interactive = opts.source === "web" && !opts.autoApprove;
  return opts.autoApprove === true || opts.permissionMode === "bypassPermissions" || !interactive;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Update"]);

export function autoApprovesTool(toolName: string, bypass: boolean, mode: PermissionMode): boolean {
  if (bypass || mode === "bypassPermissions") return true;
  if (mode === "acceptEdits") return EDIT_TOOLS.has(toolName);
  return false;
}

export interface PermissionContext {
  bypass: boolean;
  currentPermissionMode: PermissionMode;
  isSubagentAllowed: ((subagentType: string) => boolean) | null;
}

// Decisão síncrona de permissão. Retorna o resultado quando a chamada pode ser resolvida na hora
// (auto-aprovação em bypass, AskUserQuestion sem humano, subagente fora do time); retorna null
// quando é preciso pedir aprovação a um humano.
export function decideImmediatePermission(
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionContext,
): PermissionResult | null {
  if (toolName === "AskUserQuestion") {
    return { behavior: "deny", message: "Pergunta encaminhada ao usuário." };
  }
  if ((toolName === "Agent" || toolName === "Task") && ctx.isSubagentAllowed) {
    const target = typeof input.subagent_type === "string" ? input.subagent_type : undefined;
    if (target && !ctx.isSubagentAllowed(target)) {
      return { behavior: "deny", message: `O agente "${target}" não está no seu time e não pode ser acionado.` };
    }
  }
  if (autoApprovesTool(toolName, ctx.bypass, ctx.currentPermissionMode)) {
    return { behavior: "allow", updatedInput: input };
  }
  return null;
}
