import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuestionAnswers } from "../runtime/questions.js";
import type { PendingQuestion } from "../providers/types.js";

export const CODEX_QUESTION_INSTRUCTIONS = `Quando precisar de uma resposta do usuário, use a tool mcp__user_input__request_user_input para exibir a pergunta e as opções clicáveis durante a execução. Use-a também fora do modo Plan, tanto em agentes quanto em projetos. Não use as ferramentas nativas request_user_input ou request_user_input_async: neste aplicativo a ferramenta MCP é o canal que aguarda a resposta e a entrega à execução. Não apresente perguntas apenas como texto ou listas no terminal. Agrupe perguntas relacionadas em uma chamada. A chamada aguarda o usuário e retorna as respostas na mesma execução. Continue o trabalho dependente dessas respostas somente depois de recebê-las. Não presuma escolhas ou aprovações, não repita a pergunta e não faça polling enquanto aguarda.`;

const questionSchema = z.object({
  id: z.string().optional(),
  header: z.string().optional(),
  question: z.string().trim().min(1),
  options: z.array(z.object({
    label: z.string().trim().min(1),
    description: z.string().default(""),
  })).default([]),
  multiSelect: z.boolean().default(false),
});

export function createUserInputMcpServer(onQuestion: (question: PendingQuestion, signal: AbortSignal) => Promise<QuestionAnswers>): McpServer {
  const server = new McpServer({ name: "user_input", version: "1.0.0" });
  server.registerTool("request_user_input", {
    description: "Exibe de uma a três perguntas persistentes com opções clicáveis e campo de resposta livre. Aguarda a resposta do usuário e retorna as respostas na mesma execução. Disponível em todos os modos.",
    inputSchema: { questions: z.array(questionSchema).min(1).max(3) },
  }, async ({ questions }, { signal }) => {
    const pending: PendingQuestion = {
      toolUseId: randomUUID(),
      questions: questions.map((q) => ({
        question: q.question,
        header: q.header || q.id || "Pergunta",
        options: q.options,
        multiSelect: q.multiSelect,
      })),
    };
    const answers = await onQuestion(pending, signal);
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "answered", requestId: pending.toolUseId, answers }) }],
    };
  });
  return server;
}

const nativeQuestionSchema = z.object({
  id: z.string().min(1),
  questions: z.array(z.object({
    title: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).optional(),
  })).min(1).max(3),
});

export function nativePendingQuestion(item: unknown): PendingQuestion | null {
  const parsed = nativeQuestionSchema.safeParse(item);
  if (!parsed.success) return null;
  return {
    toolUseId: parsed.data.id,
    questions: parsed.data.questions.map((question) => ({
      header: "Pergunta",
      question: question.title,
      options: (question.options ?? []).map((label) => ({ label, description: "" })),
      multiSelect: false,
    })),
  };
}
