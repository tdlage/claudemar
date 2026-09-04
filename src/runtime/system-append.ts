import { memoryEnabled, type MemoryTarget } from "../memory/session-memory.js";
import { BRAIN_SYSTEM_APPEND } from "../brain/mcp.js";

export interface SystemAppendParams {
  cwd: string;
  target: MemoryTarget;
  systemAppend?: string;
}

export function buildSystemAppend(params: SystemAppendParams): string {
  const parts: string[] = [];
  parts.push(
    `Você está confinado ao diretório ${params.cwd}. NÃO leia, liste ou acesse arquivos fora deste diretório ou de seus subdiretórios, e nunca navegue para diretórios pai.`,
  );
  if (memoryEnabled()) {
    parts.push(
      "Você tem memória de longo prazo de sessões ANTERIORES (fora desta conversa), guardada por projeto/agente. Esta sessão NÃO injeta esse histórico automaticamente: quando o pedido depender de algo discutido ou decidido antes que não esteja nesta conversa, use a tool mcp__memory__search_memory para buscar nas sessões anteriores deste mesmo alvo, e mcp__memory__memory_history para ver como um fato específico (sourceKey) evoluiu ao longo do tempo. Não invente histórico: se precisar, consulte a memória.",
    );
  }
  if (params.target.targetType === "orchestrator") {
    parts.push(BRAIN_SYSTEM_APPEND);
  }
  if (params.systemAppend) parts.push(params.systemAppend);
  return parts.join("\n\n");
}
