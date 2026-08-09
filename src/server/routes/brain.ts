import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Router } from "express";
import { asyncHandler, safeFilename } from "../route-utils.js";
import { brainRoot, rawDir, resolveInside, wikiDir } from "../../brain/paths.js";
import { fileAtCommit, fileHistory } from "../../brain/git.js";
import { brainSettingsManager } from "../../brain/settings.js";
import { getBackfillState, getBrainStatus } from "../../brain/status.js";
import { cancelBackfill, estimateBackfill, startBackfill } from "../../brain/backfill.js";
import { forceReindex, indexStatus, reindexRunning } from "../../brain/indexer.js";
import { countBrainPoints } from "../../brain/brain-index.js";
import { brainSearch } from "../../brain/search.js";
import { readRecallDistribution, readRecallTail } from "../../brain/recall-telemetry.js";
import { WIKI_DIRS, appendOpenLoopTransition, currentOpenLoops, markReviewed, readOpenLoops } from "../../brain/wiki.js";
import { listDigests, readDigest } from "../../brain/digest.js";
import { generateLintReport, listLintReports, readLintReport } from "../../brain/lint.js";
import { buildAdhocTriageRequest, parseTriageResult } from "../../brain/triage.js";
import { runStageJson, stageDisabledReason } from "../../brain/llm.js";
import { ATTACK_MESSAGES } from "../../brain/poisoning.fixtures.js";
import { getRedis, KEYS, getActivity, getChatterSamples } from "../../brain/redis.js";
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
import { brainEvents } from "../../brain/events.js";
import {
  handleWebhook,
  verifyWebhookSignature,
  whatsappQr,
  whatsappStatus,
} from "../../brain/connectors/whatsapp.js";
import { exportToEvents } from "../../brain/whatsapp-export.js";
import { slackManager } from "../../brain/connectors/slack.js";
import { emitCanonicalEvent } from "../../brain/canonical.js";
import type { BrainSchedulerName, BrainTenant, RawFrontmatter } from "../../brain/types.js";

export const brainRouter = Router();
export const brainPublicRouter = Router();

const FILTER_CONCURRENCY = 64;
const FILTER_MAX_MATCHES = 500;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brainPath(raw: unknown, prefix: "raw/" | "wiki/", requireMd = true): string | null {
  const relPath = typeof raw === "string" ? raw : "";
  if (!relPath.startsWith(prefix)) return null;
  if (relPath.includes("..")) return null;
  if (requireMd && !relPath.endsWith(".md")) return null;
  return resolveInside(brainRoot, relPath) ? relPath : null;
}

function closePage(rawTitle: string, rawMessage: string): string {
  const title = escapeHtml(rawTitle);
  const message = escapeHtml(rawMessage);
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;max-width:420px}</style>
</head><body><div><h2>${title}</h2><p>${message}</p><p><small>Pode fechar esta janela.</small></p></div></body></html>`;
}

brainPublicRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state || !/^[0-9a-f-]{36}$/.test(state)) {
      res.status(400).send(closePage("Autorização inválida", "Parâmetros ausentes. Feche esta janela e tente de novo."));
      return;
    }
    const consumed = await getRedis().getdel(KEYS.oauthState(state)).catch(() => null);
    if (!consumed) {
      res.status(403).send(closePage("Autorização expirada", "O pedido de autorização expirou. Tente de novo pelo dashboard."));
      return;
    }
    try {
      const email = await handleCallback(code);
      brainEvents.emit("google", { connected: true, email });
      res.send(closePage("Conta conectada", `${email} conectada ao Second Brain. Pode fechar esta janela.`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).send(closePage("Falha na conexão", msg));
    }
  }),
);

brainRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getBrainStatus());
  }),
);

brainRouter.get("/settings", (_req, res) => {
  res.json(brainSettingsManager.get());
});

brainRouter.put("/settings", (req, res) => {
  const updated = brainSettingsManager.update(req.body);
  brainSchedulers.reschedule();
  brainEvents.emit("status-changed");
  res.json(updated);
});

brainRouter.get("/contract", (_req, res) => {
  res.json({ content: getContract() });
});

brainRouter.put("/contract", (req, res) => {
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!content) {
    res.status(400).json({ error: "content é obrigatório" });
    return;
  }
  updateContract(content);
  res.json({ content: getContract() });
});

brainRouter.post(
  "/google/start",
  asyncHandler(async (_req, res) => {
    if (!googleConfigured()) {
      res.status(400).json({
        error: `Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET em Settings. Redirect URI: ${redirectUri()}`,
      });
      return;
    }
    const state = randomUUID();
    await getRedis().set(KEYS.oauthState(state), "1", "EX", 600);
    res.json({ authUrl: buildAuthUrl(state), redirectUri: redirectUri() });
  }),
);

brainRouter.get("/google/accounts", (_req, res) => {
  res.json(getAccountsStatus());
});

brainRouter.post("/google/account", (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) {
    res.status(400).json({ error: "email é obrigatório" });
    return;
  }
  const tenant = req.body?.tenant === "biosoft" ? ("biosoft" as BrainTenant) : ("personal" as BrainTenant);
  const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim() : undefined;
  brainSettingsManager.upsertAccount(email, { tenant, label });
  res.json(getAccountsStatus());
});

brainRouter.post(
  "/google/disconnect",
  asyncHandler(async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      res.status(400).json({ error: "email é obrigatório" });
      return;
    }
    await disconnectAccount(email);
    brainEvents.emit("google", { connected: false, email });
    res.json({ disconnected: true, accounts: getAccountsStatus() });
  }),
);

function paramStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function schedulerName(req: { params: Record<string, unknown> }): BrainSchedulerName | null {
  const name = paramStr(req.params.name);
  return brainSchedulers.names().includes(name as BrainSchedulerName) ? (name as BrainSchedulerName) : null;
}

brainRouter.post("/connectors/:name/pause", (req, res) => {
  const name = schedulerName(req);
  if (!name) {
    res.status(404).json({ error: "scheduler desconhecido" });
    return;
  }
  brainSettingsManager.setScheduler(name, false);
  if (name === "slack") void slackManager.stop();
  brainEvents.emit("status-changed");
  res.json({ name, enabled: false });
});

brainRouter.post("/connectors/:name/resume", (req, res) => {
  const name = schedulerName(req);
  if (!name) {
    res.status(404).json({ error: "scheduler desconhecido" });
    return;
  }
  brainSettingsManager.setScheduler(name, true);
  brainEvents.emit("status-changed");
  res.json({ name, enabled: true });
});

brainRouter.post(
  "/connectors/:name/run-now",
  asyncHandler(async (req, res) => {
    const name = schedulerName(req);
    if (!name) {
      res.status(404).json({ error: "scheduler desconhecido" });
      return;
    }
    if (brainSchedulers.isInFlight(name)) {
      res.status(409).json({ error: "já em execução" });
      return;
    }
    const result = await brainSchedulers.runNow(name);
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

    const channelDir = resolve(rawDir, channel);
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
        const parsed = parseRawFile(await readFile(resolve(brainRoot, relPath), "utf-8"));
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
    const relPath = brainPath(req.query.path, "raw/");
    const abs = relPath ? resolveInside(brainRoot, relPath) : null;
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
    const relPath = brainPath(req.query.path, "wiki/");
    const abs = relPath ? resolveInside(brainRoot, relPath) : null;
    if (!relPath || !abs) {
      res.status(400).json({ error: "path inválido" });
      return;
    }
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    if (ref) {
      const content = await fileAtCommit(relPath, ref);
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
    const relPath = brainPath(req.query.path, "wiki/");
    if (!relPath) {
      res.status(400).json({ error: "path inválido" });
      return;
    }
    res.json(await fileHistory(relPath, 30));
  }),
);

brainRouter.get(
  "/state/open-loops",
  asyncHandler(async (req, res) => {
    const entries = await readOpenLoops();
    res.json(req.query.view === "all" ? entries : currentOpenLoops(entries));
  }),
);

brainRouter.post(
  "/open-loops/:id/close",
  asyncHandler(async (req, res) => {
    const transition = await appendOpenLoopTransition(paramStr(req.params.id), "done");
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
    const transition = await appendOpenLoopTransition(paramStr(req.params.id), "open");
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
    res.json(await listDigests());
  }),
);

brainRouter.get(
  "/digest",
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const content = await readDigest(date);
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
    const relPath = brainPath(req.body?.path, "wiki/");
    if (!relPath) {
      res.status(400).json({ error: "path inválido" });
      return;
    }
    const ok = await markReviewed(relPath);
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
    res.json(await listLintReports());
  }),
);

brainRouter.get(
  "/lint",
  asyncHandler(async (req, res) => {
    const week = typeof req.query.week === "string" ? req.query.week : "";
    const content = await readLintReport(week);
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
    res.json(await generateLintReport());
  }),
);

brainRouter.post(
  "/dev/poison-run",
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
        const raw = await runStageJson("triage", buildAdhocTriageRequest(attack.subject, attack.body));
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
    res.json(await quarantineList());
  }),
);

brainRouter.get(
  "/quarantine/:id",
  asyncHandler(async (req, res) => {
    const item = await quarantineRead(paramStr(req.params.id));
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
    const ok = await quarantineDiscard(paramStr(req.params.id));
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
    const queue = await quarantineRetry(paramStr(req.params.id));
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
    const tenant = req.body?.tenant === "personal" || req.body?.tenant === "biosoft" ? req.body.tenant : undefined;
    const type = typeof req.body?.type === "string" ? (req.body.type as never) : undefined;
    const limit = Number(req.body?.limit) || undefined;
    const includePii = req.body?.includePii === true;
    try {
      const result = await brainSearch({
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
    res.json(await readRecallTail(month, limit));
  }),
);

brainRouter.get(
  "/telemetry/recall/distribution",
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    res.json(await readRecallDistribution(month));
  }),
);

brainRouter.get(
  "/index/status",
  asyncHandler(async (_req, res) => {
    const [status, points] = await Promise.all([indexStatus(), countBrainPoints()]);
    res.json({ ...status, points: points.total, currentPoints: points.current });
  }),
);

brainRouter.post(
  "/index/reindex",
  asyncHandler(async (req, res) => {
    if (reindexRunning()) {
      res.status(409).json({ error: "reindex já em execução" });
      return;
    }
    const full = req.body?.full === true;
    forceReindex(full).catch((err) => {
      console.error("[brain:index] reindex falhou:", err instanceof Error ? err.message : String(err));
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
    const result = await startBackfill({ monthsRaw, monthsCompile, accounts });
    if ("error" in result) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json(result);
  }),
);

brainRouter.get(
  "/backfill/status",
  asyncHandler(async (_req, res) => {
    res.json(await getBackfillState());
  }),
);

brainRouter.post(
  "/backfill/cancel",
  asyncHandler(async (_req, res) => {
    res.json(await cancelBackfill());
  }),
);

brainRouter.get(
  "/backfill/estimate",
  asyncHandler(async (req, res) => {
    const monthsCompile = Number(req.query.monthsCompile) || brainSettingsManager.get().backfill.monthsCompile;
    res.json(await estimateBackfill(monthsCompile));
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
  const result = await handleWebhook(parsed);
  res.json({ result });
});

brainRouter.post(
  "/whatsapp/import",
  asyncHandler(async (req, res) => {
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
      if ((await emitCanonicalEvent(event)) === "emitted") emitted += 1;
    }
    const threads = new Set(events.map((e) => e.thread_key)).size;
    res.json({ parsed: events.length, emitted, threads });
    void brainSchedulers.runNow("ingest");
  }),
);

brainRouter.get(
  "/whatsapp/status",
  asyncHandler(async (_req, res) => {
    res.json(await whatsappStatus());
  }),
);

brainRouter.get(
  "/whatsapp/qr",
  asyncHandler(async (_req, res) => {
    const qr = await whatsappQr();
    if ("error" in qr) {
      res.status(502).json(qr);
      return;
    }
    res.json(qr);
  }),
);

brainRouter.get(
  "/chatter/samples",
  asyncHandler(async (_req, res) => {
    res.json(await getChatterSamples());
  }),
);

brainRouter.get(
  "/activity",
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    res.json(await getActivity(limit));
  }),
);

brainRouter.get(
  "/log",
  asyncHandler(async (req, res) => {
    const lines = Math.min(2000, Math.max(10, Number(req.query.lines) || 500));
    const logPath = resolve(wikiDir, "log.md");
    if (!existsSync(logPath)) {
      res.json({ content: "" });
      return;
    }
    const content = await readFile(logPath, "utf-8");
    const allLines = content.split("\n");
    res.json({ content: allLines.slice(-lines).join("\n") });
  }),
);
