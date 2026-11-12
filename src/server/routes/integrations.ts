import { Router } from "express";
import type { Request, Response } from "express";
import { authorizationCookieName, claimAuthorization, ReauthRequiredError } from "../../integrations/oauth.js";
import { callbackPath, isIntegrationProvider, PROVIDERS, type IntegrationProvider } from "../../integrations/providers.js";
import {
  accountViews,
  agentIntegrationViews,
  disconnectAccount,
  finishConnection,
  IntegrationRequestError,
  linkAccount,
  providerViews,
  startConnection,
  unlinkAccount,
} from "../../integrations/service.js";
import { sendCallbackPage } from "../callback-page.js";
import { readCookie } from "../route-utils.js";

export const integrationsRouter = Router();
export const integrationsPublicRouter = Router();

const BROADCAST_CHANNEL = "claudemar-integrations";

// Valida o agente de /:name (existência; o acesso do usuário já é checado no router de agentes).
export type AgentResolver = (req: Request) => string;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function integrationRoute(handler: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((err) => {
      if (res.headersSent) {
        res.destroy(err instanceof Error ? err : undefined);
        return;
      }
      if (err instanceof IntegrationRequestError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err instanceof ReauthRequiredError) {
        res.status(409).json({ error: err.message });
        return;
      }
      console.error("[integrations] request failed:", errorMessage(err));
      res.status(502).json({ error: errorMessage(err) });
    });
  };
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== "string" || !value) throw new IntegrationRequestError(400, `${key} inválido`);
  return value;
}

function cookieOptions(req: Request, provider: IntegrationProvider) {
  return { httpOnly: true, sameSite: "lax" as const, secure: req.secure, path: callbackPath(provider) };
}

export function registerAgentIntegrationRoutes(router: Router, resolveAgent: AgentResolver): void {
  router.get("/:name/integrations", integrationRoute(async (req, res) => {
    const agentName = resolveAgent(req);
    const ctx = req.ctx!;
    res.json({ providers: providerViews(ctx), links: agentIntegrationViews(ctx, agentName), accounts: accountViews(ctx) });
  }));

  router.post("/:name/integrations", integrationRoute(async (req, res) => {
    const agentName = resolveAgent(req);
    const { accountId } = (req.body ?? {}) as { accountId?: unknown };
    if (typeof accountId !== "string" || !accountId) throw new IntegrationRequestError(400, "accountId é obrigatório");
    res.status(201).json(await linkAccount(req.ctx!, agentName, accountId));
  }));

  router.post("/:name/integrations/connect", integrationRoute(async (req, res) => {
    const agentName = resolveAgent(req);
    const { provider, accountId } = (req.body ?? {}) as { provider?: unknown; accountId?: unknown };
    if (!isIntegrationProvider(provider)) throw new IntegrationRequestError(400, "Provedor inválido");
    const reconnect = typeof accountId === "string" && accountId ? accountId : null;
    const start = await startConnection(req.ctx!, provider, agentName, reconnect);
    res.cookie(start.cookieName, start.browserKey, { ...cookieOptions(req, provider), maxAge: start.maxAgeMs });
    res.json({ authUrl: start.authUrl });
  }));

  router.delete("/:name/integrations/:id", integrationRoute(async (req, res) => {
    await unlinkAccount(req.ctx!, resolveAgent(req), param(req, "id"));
    res.json({ removed: true });
  }));
}

integrationsRouter.delete("/accounts/:id", integrationRoute(async (req, res) => {
  await disconnectAccount(req.ctx!, param(req, "id"));
  res.json({ disconnected: true });
}));

interface CallbackOutcome {
  ok: boolean;
  title: string;
  message: string;
  returnTo: string;
}

function sendIntegrationCallback(res: Response, status: number, outcome: CallbackOutcome): void {
  const event = JSON.stringify({ type: outcome.ok ? "connected" : "error", message: outcome.message }).replace(/</g, "\\u003c");
  sendCallbackPage(res, status, {
    lang: "pt",
    title: outcome.title,
    message: outcome.message,
    link: { href: outcome.returnTo, label: "Voltar ao Claudemar" },
    script: `try{var channel=new BroadcastChannel(${JSON.stringify(BROADCAST_CHANNEL)});channel.postMessage(${event});channel.close();setTimeout(function(){window.close()},700)}catch(e){}`,
  });
}

function queryParam(req: Request, key: string): string | null {
  const value = req.query[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const EXPIRED: CallbackOutcome = { ok: false, title: "Autorização expirada", message: "Inicie a conexão novamente pelo Claudemar.", returnTo: "/" };

integrationsPublicRouter.get("/:provider/callback", integrationRoute(async (req, res) => {
  const provider = req.params.provider;
  const state = queryParam(req, "state");
  if (!isIntegrationProvider(provider) || !state) {
    sendIntegrationCallback(res, 400, EXPIRED);
    return;
  }
  const label = PROVIDERS[provider].label;
  const cookieName = authorizationCookieName(state);
  const claim = claimAuthorization(provider, state, readCookie(req, cookieName));
  res.clearCookie(cookieName, cookieOptions(req, provider));
  if (claim.status === "expired") {
    sendIntegrationCallback(res, 400, EXPIRED);
    return;
  }
  if (claim.status === "other-browser") {
    const message = "Esta autorização foi iniciada em outro navegador ou sessão. Inicie a conexão novamente pelo Claudemar neste navegador.";
    sendIntegrationCallback(res, 403, { ok: false, title: "Autorização recusada", message, returnTo: claim.returnTo ?? "/" });
    return;
  }
  const { pending } = claim;
  const returnTo = pending.returnTo ?? "/";
  const error = queryParam(req, "error");
  if (error) {
    const message = error === "access_denied" ? `O acesso ao ${label} não foi autorizado.` : `O ${label} retornou um erro: ${error}`;
    sendIntegrationCallback(res, 400, { ok: false, title: "Autorização cancelada", message, returnTo });
    return;
  }
  const code = queryParam(req, "code");
  if (!code) {
    sendIntegrationCallback(res, 400, { ok: false, title: "Falha na autorização", message: `O ${label} não retornou um código de autorização.`, returnTo });
    return;
  }
  try {
    const { account, linkError } = await finishConnection(pending, code);
    if (linkError) {
      sendIntegrationCallback(res, 409, { ok: false, title: `${label} conectado`, message: linkError, returnTo });
      return;
    }
    const message = pending.accountId
      ? `A conexão de ${account.name} foi renovada. Você já pode fechar esta janela.`
      : `${account.name} foi conectado ao agente ${pending.agentName}. Você já pode fechar esta janela.`;
    sendIntegrationCallback(res, 200, { ok: true, title: `${label} conectado`, message, returnTo });
  } catch (err) {
    console.error(`[integrations] ${provider} authorization failed:`, errorMessage(err));
    sendIntegrationCallback(res, 400, { ok: false, title: "Falha na conexão", message: errorMessage(err), returnTo });
  }
}));
