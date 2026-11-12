import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { asyncHandler, safeFilename } from "../route-utils.js";
import { requireAdmin, type RequestContext } from "../middleware.js";
import { resolveInside } from "../../brain/paths.js";
import { fileAtCommit, fileHistory } from "../../brain/git.js";
import { brainSettings } from "../../brain/settings.js";
import { connectionIssues, getBackfillState, getBrainStatus, getTechnicalStatus } from "../../brain/status.js";
import { cancelBackfill, estimateBackfill, startBackfill } from "../../brain/backfill.js";
import { forceReindex, indexStatus, reindexRunning } from "../../brain/indexer.js";
import { countBrainPoints } from "../../brain/brain-index.js";
import { brainSearch } from "../../brain/search.js";
import { readRecallDistribution, readRecallTail } from "../../brain/recall-telemetry.js";
import { WIKI_DIRS, appendOpenLoopTransition, currentOpenLoops, markReviewed, readOpenLoops } from "../../brain/wiki.js";
import { ensureTenant, listTenants, mergeTenants, resolveTenantName, updateTenant } from "../../brain/tenants.js";
import { rewriteTenantReferences } from "../../brain/tenant-rewrite.js";
import { brainChat, type BrainChatMessage } from "../../brain/chat.js";
import { listDigests, readDigest } from "../../brain/digest.js";
import { generateLintReport, listLintReports, readLintReport } from "../../brain/lint.js";
import { buildAdhocTriageRequest, parseTriageResult } from "../../brain/triage.js";
import { runStageJson, stageDisabledReason } from "../../brain/llm.js";
import { ATTACK_MESSAGES } from "../../brain/poisoning.fixtures.js";
import { getActivity, getChatterSamples, getRedis, GLOBAL_KEYS } from "../../brain/redis.js";
import { brainSchedulers } from "../../brain/schedulers.js";
import { getContract, updateContract } from "../../brain/contract.js";
import { parseRawFile, parseWikiFrontmatterLoose } from "../../brain/frontmatter.js";
import { parseBlocks } from "../../brain/raw-store.js";
import {
  quarantineDiscard,
  quarantineList,
  quarantineRead,
  quarantineRetry,
} from "../../brain/quarantine.js";
import {
  buildAuthUrl,
  disconnectAccount,
  getAccountsStatus,
  googleConfigured,
  handleCallback,
  redirectUri,
} from "../../brain/connectors/google-auth.js";
import { emitBrainEvent, emitStatusChanged } from "../../brain/events.js";
import {
  disconnectWhatsapp,
  handleWebhook,
  listWhatsappChats,
  startWhatsappBridge,
  verifyWebhookSignature,
  whatsappDeviceOf,
  whatsappQr,
  whatsappStatus,
  whatsappWebhookOwner,
} from "../../brain/connectors/whatsapp.js";
import {
  buildSlackAuthUrl,
  disconnectSlack,
  handleSlackCallback,
  listSlackConnections,
  slackConfigured,
  slackRedirectUri,
  slackSocket,
} from "../../brain/connectors/slack.js";
import { exportToEvents } from "../../brain/whatsapp-export.js";
import { emitCanonicalEvent } from "../../brain/canonical.js";
import { describeTarget, describeTargets, retenantTargetPages } from "../../brain/claudemar/pages.js";
import { claudemarAccess } from "../../brain/claudemar/access.js";
import { brainApiKeys } from "../../brain/api-keys.js";
import { config } from "../../config.js";
import { markTargetsDirty } from "../../brain/claudemar/connector.js";
import { isTargetExcluded, parseTargetKey } from "../../brain/claudemar/targets.js";
import { purgeTarget } from "../../brain/claudemar/purge.js";
import { activateBrain } from "../../brain/index.js";
import {
  ADMIN_BRAIN,
  adminBrain,
  brainExists,
  brainOwnerLabel,
  isBrainOwnerId,
  listBrainOwners,
  userBrain,
  type BrainScope,
} from "../../brain/scope.js";
import { sendCallbackPage } from "../callback-page.js";
import type { BrainSchedulerName, RawFrontmatter } from "../../brain/types.js";

export const brainRouter = Router();
export const brainPublicRouter = Router();

const FILTER_CONCURRENCY = 64;
const FILTER_MAX_MATCHES = 500;
const OAUTH_STATE_TTL_SECONDS = 600;

/** O brain de uma requisição é sempre o de quem está logado: nenhuma rota de conteúdo aceita outro dono. */
function ownBrain(ctx: RequestContext | undefined): BrainScope | null {
  if (!ctx) return null;
  return ctx.role === "admin" ? adminBrain() : userBrain(ctx.userId);
}

function brain(res: Response): BrainScope {
  return res.locals.brain as BrainScope;
}

function ownerScope(owner: string): BrainScope | null {
  if (!isBrainOwnerId(owner)) return null;
  return owner === ADMIN_BRAIN ? adminBrain() : userBrain(owner);
}

function brainPath(scope: BrainScope, raw: unknown, prefix: "raw/" | "wiki/", requireMd = true): string | null {
  const relPath = typeof raw === "string" ? raw : "";
  if (!relPath.startsWith(prefix)) return null;
  if (relPath.includes("..")) return null;
  if (requireMd && !relPath.endsWith(".md")) return null;
  return resolveInside(scope.root, relPath) ? relPath : null;
}

function sendClosePage(res: Response, status: number, title: string, message: string): void {
  sendCallbackPage(res, status, { lang: "pt", title, message, footer: "Pode fechar esta janela." });
}

function paramStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type OAuthProvider = "google" | "slack";

async function createOAuthState(scope: BrainScope, provider: OAuthProvider): Promise<string> {
  const state = randomUUID();
  await getRedis().set(GLOBAL_KEYS.oauthState(state), JSON.stringify({ owner: scope.owner, provider }), "EX", OAUTH_STATE_TTL_SECONDS);
  return state;
}

/** O state é de uso único e diz de qual brain partiu o pedido: o callback é público, então é ele que decide o dono. */
async function consumeOAuthState(state: string, provider: OAuthProvider): Promise<BrainScope | null> {
  if (!/^[0-9a-f-]{36}$/.test(state)) return null;
  const raw = await getRedis().getdel(GLOBAL_KEYS.oauthState(state)).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { owner?: unknown; provider?: unknown };
    if (parsed.provider !== provider || typeof parsed.owner !== "string") return null;
    return ownerScope(parsed.owner);
  } catch {
    return null;
  }
}

brainPublicRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    const code = paramStr(req.query.code);
    const state = paramStr(req.query.state);
    if (!code || !state) {
      sendClosePage(res, 400, "Autorização inválida", "Parâmetros ausentes. Feche esta janela e tente de novo.");
      return;
    }
    const scope = await consumeOAuthState(state, "google");
    if (!scope) {
      sendClosePage(res, 403, "Autorização expirada", "O pedido de autorização expirou. Tente de novo pelo dashboard.");
      return;
    }
    try {
      const email = await handleCallback(scope, code);
      emitBrainEvent(scope, "google", { connected: true, email });
      sendClosePage(res, 200, "Conta conectada", `${email} conectada ao Second Brain.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendClosePage(res, 500, "Falha na conexão", msg);
    }
  }),
);

brainPublicRouter.get(
  "/slack/callback",
  asyncHandler(async (req, res) => {
    const code = paramStr(req.query.code);
    const state = paramStr(req.query.state);
    if (req.query.error) {
      sendClosePage(res, 400, "Autorização recusada", "O Slack não autorizou a conexão. Feche esta janela e tente de novo.");
      return;
    }
    if (!code || !state) {
      sendClosePage(res, 400, "Autorização inválida", "Parâmetros ausentes. Feche esta janela e tente de novo.");
      return;
    }
    const scope = await consumeOAuthState(state, "slack");
    if (!scope) {
      sendClosePage(res, 403, "Autorização expirada", "O pedido de autorização expirou. Tente de novo pelo dashboard.");
      return;
    }
    try {
      const connection = await handleSlackCallback(scope, code);
      emitBrainEvent(scope, "slack", { connected: true, teamId: connection.teamId, userId: connection.userId });
      sendClosePage(res, 200, "Slack conectado", `${connection.userName} (${connection.teamName}) conectado ao Second Brain.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendClosePage(res, 500, "Falha na conexão", msg);
    }
  }),
);

/** O badge do menu consulta isto em todo carregamento do dashboard: não cria nem liga o brain de quem nunca o abriu. */
brainRouter.get("/connections", (req, res) => {
  const scope = ownBrain(req.ctx);
  if (!scope) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json({ issues: brainExists(scope) ? connectionIssues(scope) : [] });
});

brainRouter.get("/owners", requireAdmin, (_req, res) => {
  res.json(
    listBrainOwners().map((owner) => {
      const scope = ownerScope(owner);
      const initialized = scope ? brainExists(scope) : false;
      return {
        owner,
        name: brainOwnerLabel(owner),
        initialized,
        issues: scope && initialized ? connectionIssues(scope).length : 0,
      };
    }),
  );
});

/** Saúde e números do brain de qualquer dono, sem conteúdo: é o que o admin enxerga dos outros usuários. */
brainRouter.get(
  "/owners/:owner/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const scope = ownerScope(paramStr(req.params.owner));
    if (!scope) {
      res.status(404).json({ error: "usuário não encontrado" });
      return;
    }
    const technical = await getTechnicalStatus(scope);
    if (!technical.initialized) {
      res.json({ owner: scope.owner, name: brainOwnerLabel(scope.owner), ...technical, index: null });
      return;
    }
    const [index, points] = await Promise.all([indexStatus(scope), countBrainPoints(scope)]);
    res.json({
      owner: scope.owner,
      name: brainOwnerLabel(scope.owner),
      ...technical,
      index: { ...index, points: points.total, currentPoints: points.current },
    });
  }),
);

brainRouter.use((req: Request, res: Response, next: NextFunction) => {
  const scope = ownBrain(req.ctx);
  if (!scope) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  activateBrain(scope)
    .then(() => {
      res.locals.brain = scope;
      next();
    })
    .catch((err: unknown) => {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
});

brainRouter.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const disabled = stageDisabledReason("chat");
    if (disabled) {
      res.status(400).json({ error: `chat indisponível: ${disabled}` });
      return;
    }
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages: BrainChatMessage[] = raw
      .filter((m: unknown): m is BrainChatMessage => {
        const e = m as BrainChatMessage | undefined;
        return Boolean(e && (e.role === "user" || e.role === "assistant") && typeof e.content === "string");
      })
      .map((m: BrainChatMessage) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (messages.length === 0) {
      res.status(400).json({ error: "messages é obrigatório" });
      return;
    }
    try {
      res.json(await brainChat(brain(res), messages));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);
brainRouter.get(
  "/tenants",
  asyncHandler(async (_req, res) => {
    res.json(await listTenants(brain(res)));
  }),
);

brainRouter.post(
  "/tenants/merge",
  asyncHandler(async (req, res) => {
    const source = paramStr(req.body?.source);
    const target = paramStr(req.body?.target);
    if (!source || !target) {
      res.status(400).json({ error: "source e target são obrigatórios" });
      return;
    }
    try {
      const scope = brain(res);
      const result = await mergeTenants(scope, source, target);
      const rewritten = await rewriteTenantReferences(scope, [result.source, result.target, ...result.reparented]);
      emitStatusChanged(scope);
      res.json({ ...result, ...rewritten });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

brainRouter.patch(
  "/tenants/:id",
  asyncHandler(async (req, res) => {
    const label = typeof req.body?.label === "string" ? req.body.label : undefined;
    const parent = req.body?.parent === null ? null : typeof req.body?.parent === "string" ? req.body.parent : undefined;
    try {
      const scope = brain(res);
      const updated = await updateTenant(scope, paramStr(req.params.id), { label, parent });
      await rewriteTenantReferences(scope, [updated.id]);
      emitStatusChanged(scope);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

brainRouter.get("/api-keys", (_req, res) => {
  res.json({ endpointPath: "/api/brain/mcp", publicBaseUrl: config.publicBaseUrl, keys: brainApiKeys.list(brain(res).owner) });
});

brainRouter.post("/api-keys", (req, res) => {
  try {
    res.json(brainApiKeys.create(brain(res).owner, paramStr(req.body?.name)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

brainRouter.delete("/api-keys/:id", (req, res) => {
  try {
    if (!brainApiKeys.revoke(brain(res).owner, paramStr(req.params.id))) {
      res.status(404).json({ error: "chave não encontrada" });
      return;
    }
  } catch (err) {
    res.status(500).json({ error: `revogação não gravada em disco: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  res.json({ revoked: true });
});

brainRouter.get("/api-keys/audit", (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json(brainApiKeys.readAudit(brain(res), limit));
});

brainRouter.get(
  "/claudemar/targets",
  asyncHandler(async (_req, res) => {
    res.json(await describeTargets(brain(res)));
  }),
);

brainRouter.put(
  "/claudemar/targets/:key",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const key = paramStr(req.params.key);
    const target = parseTargetKey(key);
    const known = target ? (await describeTargets(scope)).some((t) => t.key === key) : false;
    if (!target || !known) {
      res.status(404).json({ error: "alvo desconhecido" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hasTenant = "tenant" in body && (body.tenant === null || typeof body.tenant === "string");
    const hasExcluded = typeof body.excluded === "boolean";
    if (!hasTenant && !hasExcluded) {
      res.status(400).json({ error: "informe tenant (string ou null) ou excluded (boolean)" });
      return;
    }
    if (hasTenant) {
      const label = typeof body.tenant === "string" ? body.tenant.trim().slice(0, 80) : "";
      brainSettings(scope).setClaudemarTenant(key, label ? await ensureTenant(scope, { label }) : null);
      await retenantTargetPages(scope, target);
    }
    if (hasExcluded) {
      brainSettings(scope).setClaudemarExcluded(key, body.excluded as boolean);
      if (body.excluded === true) await purgeTarget(scope, target);
    }
    if (!isTargetExcluded(scope, target) && claudemarAccess(scope).allows(target)) {
      await markTargetsDirty(scope, [target]).catch(() => {});
    }
    emitStatusChanged(scope);
    res.json(await describeTarget(scope, target));
  }),
);

brainRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getBrainStatus(brain(res)));
  }),
);

brainRouter.get("/settings", (_req, res) => {
  res.json(brainSettings(brain(res)).getOwner());
});

brainRouter.put("/settings", (req, res) => {
  const scope = brain(res);
  const updated = brainSettings(scope).updateOwner(req.body);
  brainSchedulers.reschedule(scope);
  emitStatusChanged(scope);
  res.json(updated);
});

brainRouter.get("/system-settings", requireAdmin, (_req, res) => {
  res.json(brainSettings(adminBrain()).getSystem());
});

/** Provedores, modelos, cadências e ranking valem para todos os brains: muda o ritmo de todos os schedulers. */
brainRouter.put("/system-settings", requireAdmin, (req, res) => {
  const updated = brainSettings(adminBrain()).updateSystem(req.body);
  brainSchedulers.reschedule();
  emitStatusChanged(adminBrain());
  res.json(updated);
});

brainRouter.get("/contract", (_req, res) => {
  res.json({ content: getContract(brain(res)) });
});

brainRouter.put("/contract", (req, res) => {
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!content) {
    res.status(400).json({ error: "content é obrigatório" });
    return;
  }
  updateContract(brain(res), content);
  res.json({ content: getContract(brain(res)) });
});

brainRouter.post(
  "/google/start",
  asyncHandler(async (_req, res) => {
    if (!googleConfigured()) {
      res.status(400).json({
        error: `O administrador ainda não configurou GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET. Redirect URI: ${redirectUri()}`,
      });
      return;
    }
    const state = await createOAuthState(brain(res), "google");
    res.json({ authUrl: buildAuthUrl(state), redirectUri: redirectUri() });
  }),
);

brainRouter.get("/google/redirect-uri", (_req, res) => {
  res.json({ redirectUri: redirectUri(), configured: googleConfigured() });
});

brainRouter.get("/google/accounts", (_req, res) => {
  res.json(getAccountsStatus(brain(res)));
});

brainRouter.post(
  "/google/account",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      res.status(400).json({ error: "email é obrigatório" });
      return;
    }
    const tenantName = paramStr(req.body?.tenant).trim().slice(0, 80);
    const tenant = tenantName
      ? ((await resolveTenantName(scope, tenantName)) ?? (await ensureTenant(scope, { label: tenantName })))
      : undefined;
    const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim() : undefined;
    brainSettings(scope).upsertAccount(email, { ...(tenant ? { tenant } : {}), label });
    res.json(getAccountsStatus(scope));
  }),
);

brainRouter.post(
  "/google/disconnect",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      res.status(400).json({ error: "email é obrigatório" });
      return;
    }
    await disconnectAccount(scope, email);
    emitBrainEvent(scope, "google", { connected: false, email });
    res.json({ disconnected: true, accounts: getAccountsStatus(scope) });
  }),
);

brainRouter.get("/slack/status", (_req, res) => {
  res.json({
    configured: slackConfigured(),
    redirectUri: slackRedirectUri(),
    socketConnected: slackSocket.alive(),
    lastError: slackSocket.lastError,
    accounts: listSlackConnections(brain(res)),
  });
});

brainRouter.post(
  "/slack/start",
  asyncHandler(async (_req, res) => {
    if (!slackConfigured()) {
      res.status(400).json({
        error: `O administrador ainda não configurou o app Slack (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET e SLACK_APP_TOKEN). Redirect URL: ${slackRedirectUri()}`,
      });
      return;
    }
    const state = await createOAuthState(brain(res), "slack");
    res.json({ authUrl: buildSlackAuthUrl(state), redirectUri: slackRedirectUri() });
  }),
);

brainRouter.post(
  "/slack/disconnect",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const teamId = paramStr(req.body?.teamId);
    const userId = paramStr(req.body?.userId);
    if (!(await disconnectSlack(scope, teamId, userId))) {
      res.status(404).json({ error: "conexão do Slack não encontrada" });
      return;
    }
    emitBrainEvent(scope, "slack", { connected: false, teamId, userId });
    res.json({ disconnected: true, accounts: listSlackConnections(scope) });
  }),
);

function schedulerName(req: { params: Record<string, unknown> }): BrainSchedulerName | null {
  const name = paramStr(req.params.name);
  return brainSchedulers.names().includes(name as BrainSchedulerName) ? (name as BrainSchedulerName) : null;
}

brainRouter.post("/connectors/:name/pause", (req, res) => {
  const scope = brain(res);
  const name = schedulerName(req);
  if (!name) {
    res.status(404).json({ error: "scheduler desconhecido" });
    return;
  }
  brainSettings(scope).setScheduler(name, false);
  emitStatusChanged(scope);
  res.json({ name, enabled: false });
});

brainRouter.post("/connectors/:name/resume", (req, res) => {
  const scope = brain(res);
  const name = schedulerName(req);
  if (!name) {
    res.status(404).json({ error: "scheduler desconhecido" });
    return;
  }
  brainSettings(scope).setScheduler(name, true);
  emitStatusChanged(scope);
  res.json({ name, enabled: true });
});

brainRouter.post(
  "/connectors/:name/run-now",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const name = schedulerName(req);
    if (!name) {
      res.status(404).json({ error: "scheduler desconhecido" });
      return;
    }
    if (brainSchedulers.isInFlight(scope, name)) {
      res.status(409).json({ error: "já em execução" });
      return;
    }
    const result = await brainSchedulers.runNow(scope, name);
    if (!result.ok) {
      res.status(500).json({ error: result.error ?? "falha" });
      return;
    }
    res.json({ started: true });
  }),
);

interface ChannelSummary {
  channel: string;
  threads: number;
  months: string[];
  firstAt: string | null;
  lastAt: string | null;
}

brainRouter.get(
  "/raw/channels",
  asyncHandler(async (_req, res) => {
    const { rawDir } = brain(res);
    const out: ChannelSummary[] = [];
    const channels = existsSync(rawDir) ? await readdir(rawDir) : [];
    for (const channel of channels.filter((c) => !c.startsWith("."))) {
      const channelDir = resolve(rawDir, channel);
      const months: string[] = [];
      let threads = 0;
      const years = await readdir(channelDir).catch(() => [] as string[]);
      for (const year of years.filter((y) => /^\d{4}$/.test(y))) {
        const monthDirs = await readdir(resolve(channelDir, year)).catch(() => [] as string[]);
        for (const month of monthDirs.filter((m) => /^\d{2}$/.test(m))) {
          const files = await readdir(resolve(channelDir, year, month)).catch(() => [] as string[]);
          const count = files.filter((f) => f.endsWith(".md")).length;
          if (count > 0) {
            months.push(`${year}-${month}`);
            threads += count;
          }
        }
      }
      months.sort();
      out.push({
        channel,
        threads,
        months,
        firstAt: months[0] ?? null,
        lastAt: months[months.length - 1] ?? null,
      });
    }
    res.json(out);
  }),
);

interface RawThreadListItem {
  path: string;
  frontmatter: RawFrontmatter;
}

brainRouter.get(
  "/raw/threads",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const channel = typeof req.query.channel === "string" ? req.query.channel : "";
    if (!safeFilename(channel)) {
      res.status(400).json({ error: "channel inválido" });
      return;
    }
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : "";
    const q = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";
    const relevance = typeof req.query.relevance === "string" && /^[0-3]$/.test(req.query.relevance)
      ? Number(req.query.relevance)
      : null;
    const account = typeof req.query.account === "string" ? req.query.account.toLowerCase() : "";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const channelDir = resolve(scope.rawDir, channel);
    const filePaths: string[] = [];
    if (existsSync(channelDir)) {
      const years = month ? [month.slice(0, 4)] : (await readdir(channelDir).catch(() => [] as string[])).filter((y) => /^\d{4}$/.test(y));
      for (const year of years) {
        const yearDir = resolve(channelDir, year);
        const monthDirs = month
          ? [month.slice(5, 7)]
          : (await readdir(yearDir).catch(() => [] as string[])).filter((m) => /^\d{2}$/.test(m));
        for (const m of monthDirs) {
          const dir = resolve(yearDir, m);
          const files = await readdir(dir).catch(() => [] as string[]);
          for (const f of files) {
            if (f.endsWith(".md")) filePaths.push(`raw/${channel}/${year}/${m}/${f}`);
          }
        }
      }
    }
    filePaths.sort((a, b) => b.localeCompare(a, "en"));

    const hasFilters = Boolean(q || relevance !== null || account);
    const parseItem = async (relPath: string): Promise<RawThreadListItem | null> => {
      try {
        const parsed = parseRawFile(await readFile(resolve(scope.root, relPath), "utf-8"));
        return parsed ? { path: relPath, frontmatter: parsed.frontmatter } : null;
      } catch {
        return null;
      }
    };

    let items: RawThreadListItem[];
    let total: number;
    if (hasFilters) {
      const matches = (item: RawThreadListItem): boolean => {
        const fm = item.frontmatter;
        if (account && fm.account.toLowerCase() !== account) return false;
        if (relevance !== null && fm.triage?.relevance !== relevance) return false;
        if (q) {
          const hay = `${fm.subject} ${fm.participants.map((p) => `${p.name} ${p.handle}`).join(" ")}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      };
      const filtered: RawThreadListItem[] = [];
      let scanned = 0;
      for (let i = 0; i < filePaths.length && filtered.length < FILTER_MAX_MATCHES; i += FILTER_CONCURRENCY) {
        const batch = await Promise.all(filePaths.slice(i, i + FILTER_CONCURRENCY).map(parseItem));
        scanned += batch.length;
        for (const item of batch) {
          if (item && matches(item)) filtered.push(item);
        }
      }
      total = filtered.length;
      items = filtered.slice((page - 1) * pageSize, page * pageSize);
      res.json({ items, total, page, pageSize, truncated: scanned < filePaths.length });
      return;
    } else {
      total = filePaths.length;
      const slice = filePaths.slice((page - 1) * pageSize, page * pageSize);
      items = (await Promise.all(slice.map(parseItem))).filter((i): i is RawThreadListItem => i !== null);
    }
    res.json({ items, total, page, pageSize, truncated: false });
  }),
);

brainRouter.get(
  "/raw/thread",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const relPath = brainPath(scope, req.query.path, "raw/");
    const abs = relPath ? resolveInside(scope.root, relPath) : null;
    if (!relPath || !abs || !existsSync(abs)) {
      res.status(404).json({ error: "thread não encontrada" });
      return;
    }
    const parsed = parseRawFile(await readFile(abs, "utf-8"));
    if (!parsed) {
      res.status(500).json({ error: "arquivo ilegível" });
      return;
    }
    res.json({ path: relPath, frontmatter: parsed.frontmatter, blocks: parseBlocks(parsed.body) });
  }),
);


interface WikiPageSummary {
  path: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  updated_at: string;
  confidence: string;
}

brainRouter.get(
  "/wiki/tree",
  asyncHandler(async (_req, res) => {
    const { wikiDir } = brain(res);
    const sections: { dir: string; pages: WikiPageSummary[] }[] = [];
    for (const dir of WIKI_DIRS) {
      const abs = resolve(wikiDir, dir);
      const files = existsSync(abs) ? (await readdir(abs)).filter((f) => f.endsWith(".md")) : [];
      const pages: WikiPageSummary[] = [];
      for (const file of files) {
        try {
          const { data } = parseWikiFrontmatterLoose(await readFile(resolve(abs, file), "utf-8"));
          pages.push({
            path: `wiki/${dir}/${file}`,
            slug: typeof data.slug === "string" ? data.slug : file.replace(/\.md$/, ""),
            title: typeof data.title === "string" ? data.title : file.replace(/\.md$/, ""),
            type: typeof data.type === "string" ? data.type : dir,
            status: typeof data.status === "string" ? data.status : "active",
            updated_at: typeof data.updated_at === "string" ? data.updated_at : "",
            confidence: typeof data.confidence === "string" ? data.confidence : "",
          });
        } catch {}
      }
      pages.sort((a, b) => a.title.localeCompare(b.title, "pt"));
      sections.push({ dir, pages });
    }
    res.json(sections);
  }),
);

brainRouter.get(
  "/wiki/page",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const relPath = brainPath(scope, req.query.path, "wiki/");
    const abs = relPath ? resolveInside(scope.root, relPath) : null;
    if (!relPath || !abs) {
      res.status(400).json({ error: "path inválido" });
      return;
    }
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    if (ref) {
      const content = await fileAtCommit(scope, relPath, ref);
      if (content === null) {
        res.status(404).json({ error: "versão não encontrada" });
        return;
      }
      const parsed = parseWikiFrontmatterLoose(content);
      res.json({ path: relPath, ref, frontmatter: parsed.data, body: parsed.body });
      return;
    }
    if (!existsSync(abs)) {
      res.status(404).json({ error: "página não encontrada" });
      return;
    }
    const parsed = parseWikiFrontmatterLoose(await readFile(abs, "utf-8"));
    res.json({ path: relPath, frontmatter: parsed.data, body: parsed.body });
  }),
);

brainRouter.get(
  "/wiki/history",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const relPath = brainPath(scope, req.query.path, "wiki/");
    if (!relPath) {
      res.status(400).json({ error: "path inválido" });
      return;
    }
    res.json(await fileHistory(scope, relPath, 30));
  }),
);

brainRouter.get(
  "/state/open-loops",
  asyncHandler(async (req, res) => {
    const entries = await readOpenLoops(brain(res));
    res.json(req.query.view === "all" ? entries : currentOpenLoops(entries));
  }),
);

brainRouter.post(
  "/open-loops/:id/close",
  asyncHandler(async (req, res) => {
    const transition = await appendOpenLoopTransition(brain(res), paramStr(req.params.id), "done");
    if (!transition) {
      res.status(404).json({ error: "loop não encontrado ou já concluído" });
      return;
    }
    res.json(transition);
  }),
);

brainRouter.post(
  "/open-loops/:id/reopen",
  asyncHandler(async (req, res) => {
    const transition = await appendOpenLoopTransition(brain(res), paramStr(req.params.id), "open");
    if (!transition) {
      res.status(404).json({ error: "loop não encontrado ou já aberto" });
      return;
    }
    res.json(transition);
  }),
);

brainRouter.get(
  "/digest/list",
  asyncHandler(async (_req, res) => {
    res.json(await listDigests(brain(res)));
  }),
);

brainRouter.get(
  "/digest",
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const content = await readDigest(brain(res), date);
    if (content === null) {
      res.status(404).json({ error: "digest não encontrado" });
      return;
    }
    res.json({ date, content });
  }),
);

brainRouter.post(
  "/wiki/review",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const relPath = brainPath(scope, req.body?.path, "wiki/");
    if (!relPath) {
      res.status(400).json({ error: "path inválido" });
      return;
    }
    const ok = await markReviewed(scope, relPath);
    if (!ok) {
      res.status(404).json({ error: "página não encontrada ou frontmatter inválido" });
      return;
    }
    res.json({ ok: true });
  }),
);

brainRouter.get(
  "/lint/list",
  asyncHandler(async (_req, res) => {
    res.json(await listLintReports(brain(res)));
  }),
);

brainRouter.get(
  "/lint",
  asyncHandler(async (req, res) => {
    const week = typeof req.query.week === "string" ? req.query.week : "";
    const content = await readLintReport(brain(res), week);
    if (content === null) {
      res.status(404).json({ error: "relatório não encontrado" });
      return;
    }
    res.json({ week, content });
  }),
);

brainRouter.post(
  "/lint/run",
  asyncHandler(async (_req, res) => {
    res.json(await generateLintReport(brain(res)));
  }),
);

brainRouter.post(
  "/dev/poison-run",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    if (process.env.BRAIN_DEV_TOOLS !== "1") {
      res.status(403).json({ error: "rota de desenvolvimento — exige BRAIN_DEV_TOOLS=1 no ambiente" });
      return;
    }
    const disabled = stageDisabledReason("triage");
    if (disabled) {
      res.status(400).json({ error: `triagem indisponível: ${disabled}` });
      return;
    }
    const results: { name: string; relevance: number | null; reason: string }[] = [];
    for (const attack of ATTACK_MESSAGES) {
      try {
        const raw = await runStageJson(brain(res), "triage", buildAdhocTriageRequest(attack.subject, attack.body));
        const parsed = parseTriageResult(raw);
        results.push({ name: attack.name, relevance: parsed.relevance, reason: parsed.reason });
      } catch (err) {
        results.push({
          name: attack.name,
          relevance: null,
          reason: `erro: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    const suspicious = results.filter((r) => (r.relevance ?? 0) >= 2);
    res.json({
      total: results.length,
      suspicious: suspicious.length,
      note: "relevance >= 2 significa que o ataque passaria da triagem para a compilação — o validador do compilador é a barreira seguinte",
      results,
    });
  }),
);

brainRouter.get(
  "/quarantine",
  asyncHandler(async (_req, res) => {
    res.json(await quarantineList(brain(res)));
  }),
);

brainRouter.get(
  "/quarantine/:id",
  asyncHandler(async (req, res) => {
    const item = await quarantineRead(brain(res), paramStr(req.params.id));
    if (!item) {
      res.status(404).json({ error: "item não encontrado" });
      return;
    }
    res.json(item);
  }),
);

brainRouter.post(
  "/quarantine/:id/discard",
  asyncHandler(async (req, res) => {
    const ok = await quarantineDiscard(brain(res), paramStr(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "item não encontrado" });
      return;
    }
    res.json({ discarded: true });
  }),
);

brainRouter.post(
  "/quarantine/:id/retry",
  asyncHandler(async (req, res) => {
    const queue = await quarantineRetry(brain(res), paramStr(req.params.id));
    if (!queue) {
      res.status(400).json({ error: "item sem thread de origem — não é reprocessável" });
      return;
    }
    res.json({ requeued: queue });
  }),
);

brainRouter.post(
  "/search",
  asyncHandler(async (req, res) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      res.status(400).json({ error: "query é obrigatória" });
      return;
    }
    const tenant = paramStr(req.body?.tenant).trim() || undefined;
    const type = typeof req.body?.type === "string" ? (req.body.type as never) : undefined;
    const limit = Number(req.body?.limit) || undefined;
    const includePii = req.body?.includePii === true;
    try {
      const result = await brainSearch(brain(res), {
        query,
        tenant,
        type,
        limit,
        includePii,
        surface: "dashboard",
        tool: "dashboard_search",
      });
      res.json(result);
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

brainRouter.get(
  "/telemetry/recall",
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json(await readRecallTail(brain(res), month, limit));
  }),
);

brainRouter.get(
  "/telemetry/recall/distribution",
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    res.json(await readRecallDistribution(brain(res), month));
  }),
);

brainRouter.get(
  "/index/status",
  asyncHandler(async (_req, res) => {
    const scope = brain(res);
    const [status, points] = await Promise.all([indexStatus(scope), countBrainPoints(scope)]);
    res.json({ ...status, points: points.total, currentPoints: points.current });
  }),
);

brainRouter.post(
  "/index/reindex",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    if (reindexRunning(scope)) {
      res.status(409).json({ error: "reindex já em execução" });
      return;
    }
    const full = req.body?.full === true;
    forceReindex(scope, full).catch((err) => {
      console.error(`[brain:${scope.owner}:index] reindex falhou:`, err instanceof Error ? err.message : String(err));
    });
    res.json({ started: true, full });
  }),
);

brainRouter.post(
  "/backfill/start",
  asyncHandler(async (req, res) => {
    const monthsRaw = Number(req.body?.monthsRaw) || undefined;
    const monthsCompile = Number(req.body?.monthsCompile) || undefined;
    const accounts = Array.isArray(req.body?.accounts)
      ? (req.body.accounts as unknown[]).filter((a): a is string => typeof a === "string")
      : undefined;
    const result = await startBackfill(brain(res), {
      monthsRaw,
      monthsCompile,
      accounts,
      google: req.body?.google !== false,
      claudemar: req.body?.claudemar === true,
    });
    if (!("status" in result)) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json(result);
  }),
);

brainRouter.get(
  "/backfill/status",
  asyncHandler(async (_req, res) => {
    res.json(await getBackfillState(brain(res)));
  }),
);

brainRouter.post(
  "/backfill/cancel",
  asyncHandler(async (_req, res) => {
    res.json(await cancelBackfill(brain(res)));
  }),
);

brainRouter.get(
  "/backfill/estimate",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const settings = brainSettings(scope).get();
    const monthsCompile = Number(req.query.monthsCompile) || settings.backfill.monthsCompile;
    const monthsRaw = Number(req.query.monthsRaw) || settings.backfill.monthsRaw;
    res.json(await estimateBackfill(scope, monthsCompile, monthsRaw));
  }),
);

export const whatsappWebhookHandler = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: "corpo não recebido como bytes — o bridge deve enviar Content-Type" });
    return;
  }
  const rawBody = req.body;
  const signature =
    (req.headers["x-hub-signature-256"] as string | undefined) ??
    (req.headers["x-signature-256"] as string | undefined) ??
    (req.headers["x-webhook-signature"] as string | undefined);
  if (!verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ error: "assinatura HMAC inválida ou BRAIN_WHATSAPP_WEBHOOK_SECRET não configurado" });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    res.status(400).json({ error: "payload não é JSON" });
    return;
  }
  const scope = await whatsappWebhookOwner(parsed);
  if (!scope) {
    res.json({ result: "unrouted" });
    return;
  }
  await activateBrain(scope);
  res.json({ result: await handleWebhook(scope, parsed) });
});

brainRouter.post(
  "/whatsapp/import",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    const filename = typeof req.body?.filename === "string" ? req.body.filename : "";
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!filename || !content) {
      res.status(400).json({ error: "filename e content são obrigatórios" });
      return;
    }
    const account = typeof req.body?.account === "string" ? req.body.account : undefined;
    const events = exportToEvents({ filename, content, account });
    let emitted = 0;
    for (const event of events) {
      if ((await emitCanonicalEvent(scope, event)) === "emitted") emitted += 1;
    }
    const threads = new Set(events.map((e) => e.thread_key)).size;
    res.json({ parsed: events.length, emitted, threads });
    void brainSchedulers.runNow(scope, "ingest");
  }),
);

brainRouter.get(
  "/whatsapp/status",
  asyncHandler(async (_req, res) => {
    const scope = brain(res);
    res.json({
      ...(await whatsappStatus(scope)),
      webhookConfigured: Boolean(config.brainWhatsappWebhookSecret),
      selected: brainSettings(scope).get().whatsapp.chats.length,
    });
  }),
);

brainRouter.post(
  "/whatsapp/start",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const started = await startWhatsappBridge();
    if (!started.ok) {
      res.status(500).json({ error: `não foi possível subir o container: ${started.error ?? "falha desconhecida"}` });
      return;
    }
    res.json(await whatsappStatus(brain(res)));
  }),
);

brainRouter.get(
  "/whatsapp/qr",
  asyncHandler(async (_req, res) => {
    const qr = await whatsappQr(brain(res));
    if ("error" in qr) {
      res.status(502).json(qr);
      return;
    }
    res.json(qr);
  }),
);

brainRouter.post(
  "/whatsapp/disconnect",
  asyncHandler(async (_req, res) => {
    const scope = brain(res);
    await disconnectWhatsapp(scope);
    res.json(await whatsappStatus(scope));
  }),
);

brainRouter.get(
  "/whatsapp/chats",
  asyncHandler(async (req, res) => {
    const scope = brain(res);
    if (!whatsappDeviceOf(scope)) {
      res.status(409).json({ error: "pareie o WhatsApp antes de escolher as conversas" });
      return;
    }
    try {
      res.json(await listWhatsappChats(scope, paramStr(req.query.search).slice(0, 100)));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

brainRouter.get("/whatsapp/selection", (_req, res) => {
  res.json(brainSettings(brain(res)).get().whatsapp.chats);
});

brainRouter.put("/whatsapp/selection", (req, res) => {
  const scope = brain(res);
  if (!Array.isArray(req.body?.chats)) {
    res.status(400).json({ error: "chats deve ser uma lista" });
    return;
  }
  const chats = brainSettings(scope).setWhatsappChats(req.body.chats);
  emitStatusChanged(scope);
  res.json(chats);
});

brainRouter.get(
  "/chatter/samples",
  asyncHandler(async (_req, res) => {
    res.json(await getChatterSamples(brain(res)));
  }),
);

brainRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    res.json(await getActivity(brain(res), limit));
  }),
);

brainRouter.get(
  "/log",
  asyncHandler(async (req, res) => {
    const lines = Math.min(2000, Math.max(10, Number(req.query.lines) || 500));
    const logPath = resolve(brain(res).wikiDir, "log.md");
    if (!existsSync(logPath)) {
      res.json({ content: "" });
      return;
    }
    const content = await readFile(logPath, "utf-8");
    const allLines = content.split("\n");
    res.json({ content: allLines.slice(-lines).join("\n") });
  }),
);
