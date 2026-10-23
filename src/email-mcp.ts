import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { emailSettingsManager } from "./email-settings-manager.js";
import { attachmentOutsideRoots, sendEmail } from "./email-sender.js";
import { findSender, formatSender, type EmailProfile } from "./email-profiles.js";
import type { Requester } from "./requester.js";

export interface EmailAccess {
  requester: Requester;
  attachmentRoots: string[] | null;
}

// O admin anexa qualquer arquivo; usuários só os do workspace da sessão.
export function emailAccessFor(requester: Requester, cwd: string, additionalDirectories: string[] | undefined): EmailAccess {
  return { requester, attachmentRoots: requester.role === "admin" ? null : [cwd, ...(additionalDirectories ?? [])] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function availableList(senders: EmailProfile[]): string {
  return senders.length > 0 ? senders.map((s) => s.from).join(", ") : "nenhum";
}

export function createEmailMcpServer(access: EmailAccess): ReturnType<typeof createSdkMcpServer> | null {
  if (emailSettingsManager.sendersFor(access.requester).length === 0) return null;

  const sendTool = tool(
    "send_email",
    "Envia um email via AWS SES a partir de um dos remetentes liberados para este usuário. Sem `from`, usa o remetente padrão.",
    {
      to: z.array(z.string().min(3)).min(1).describe("Endereços dos destinatários"),
      subject: z.string().min(1).describe("Assunto"),
      body: z.string().min(1).describe("Corpo do email: texto puro, ou HTML quando html=true"),
      from: z.string().optional().describe("Endereço do remetente; precisa ser um dos remetentes disponíveis"),
      html: z.boolean().optional().describe("true quando o body é HTML"),
      cc: z.array(z.string().min(3)).optional().describe("Endereços em cópia"),
      attachments: z.array(z.string()).optional().describe("Caminhos absolutos dos arquivos a anexar"),
    },
    async (args) => {
      const senders = emailSettingsManager.sendersFor(access.requester);
      const sender = args.from ? findSender(senders, args.from) : emailSettingsManager.defaultSenderOf(senders);
      if (!sender) {
        const reason = args.from ? `O remetente ${args.from} não está disponível para este usuário.` : "Não há remetente padrão; informe `from`.";
        return errorResult(`${reason} Remetentes disponíveis: ${availableList(senders)}.`);
      }
      try {
        const { attachmentRoots } = access;
        const outside = attachmentRoots && args.attachments ? attachmentOutsideRoots(args.attachments, attachmentRoots) : undefined;
        if (outside && attachmentRoots) return errorResult(`O anexo ${outside} está fora das pastas permitidas: ${attachmentRoots.join(", ")}.`);
        const messageId = await sendEmail(sender, {
          to: args.to,
          cc: args.cc,
          subject: args.subject,
          body: args.body,
          html: args.html,
          attachments: args.attachments,
        });
        return { content: [{ type: "text" as const, text: `Email enviado de ${formatSender(sender)} para ${args.to.join(", ")} (MessageId ${messageId}).` }] };
      } catch (err) {
        return errorResult(`Falha ao enviar email: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  return createSdkMcpServer({ name: "email", version: "1.0.0", tools: [sendTool] });
}
