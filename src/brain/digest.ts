import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { stateDir } from "./paths.js";
import { writeFileAtomic } from "./git.js";
import { dayKeyInTz } from "./text.js";
import { getRedis, KEYS } from "./redis.js";
import { scanRawThreads } from "./raw-scan.js";
import { currentOpenLoops, readOpenLoops } from "./wiki.js";
import { brainSchedulers } from "./schedulers.js";
import { emitActivity } from "./events.js";
import type { OpenLoopEntry } from "./types.js";

const DIGEST_AT = { hour: 7, minute: 0 };

const digestDir = resolve(stateDir, "digest");

function daysBetween(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

function loopLine(loop: OpenLoopEntry, today: string): string {
  const overdue = loop.due && loop.due < today ? ` — **vencido há ${daysBetween(loop.due, today)} dia(s)**` : "";
  const due = loop.due ? ` (prazo ${loop.due})` : "";
  return `- [${loop.kind}] ${loop.title} · ${loop.counterparty}${due}${overdue}\n  próxima ação: ${loop.next_action}`;
}

let digestInFlight: Promise<{ relPath: string; sections: number }> | null = null;

export function generateDigest(): Promise<{ relPath: string; sections: number }> {
  if (!digestInFlight) {
    digestInFlight = runDigest().finally(() => {
      digestInFlight = null;
    });
  }
  return digestInFlight;
}

async function runDigest(): Promise<{ relPath: string; sections: number }> {
  const today = dayKeyInTz(new Date(), config.brainTz);
  const now = Date.now();

  const loops = currentOpenLoops(await readOpenLoops()).filter((l) => l.status === "open");
  const overdue = loops.filter((l) => l.due && l.due < today);
  const dueSoon = loops.filter((l) => l.due && l.due >= today && daysBetween(today, l.due) <= 3);
  const stalled = loops.filter(
    (l) => l.kind === "waiting_on" && daysBetween(l.last_movement, today) > 14,
  );

  const scan = await scanRawThreads();
  const critical = scan.filter(
    (t) => t.relevance === 3 && now - new Date(t.occurredTo).getTime() <= 24 * 60 * 60 * 1000,
  );

  let alerts: string[] = [];
  try {
    alerts = await getRedis().lrange(KEYS.alerts, 0, 19);
  } catch {}

  const parts: string[] = [`# Digest — ${today}`, ""];
  let sections = 0;

  if (overdue.length > 0) {
    parts.push("## Vencidos", "", ...overdue.map((l) => loopLine(l, today)), "");
    sections += 1;
  }
  if (dueSoon.length > 0) {
    parts.push("## Prazo em até 3 dias", "", ...dueSoon.map((l) => loopLine(l, today)), "");
    sections += 1;
  }
  if (critical.length > 0) {
    parts.push(
      "## Threads críticas (últimas 24h)",
      "",
      ...critical.map((t) => `- ${t.subject || t.threadKey} — \`${t.relPath}\``),
      "",
    );
    sections += 1;
  }
  if (stalled.length > 0) {
    parts.push(
      "## Esperando terceiros sem movimento há mais de 14 dias",
      "",
      ...stalled.map((l) => `- ${l.title} · ${l.counterparty} (parado desde ${l.last_movement})`),
      "",
    );
    sections += 1;
  }
  if (alerts.length > 0) {
    parts.push("## Alertas de saúde", "", ...alerts.map((a) => `- ${a}`), "");
    sections += 1;
  }
  if (sections === 0) {
    parts.push("Nada exigindo atenção hoje: sem vencidos, prazos próximos, threads críticas ou alertas.", "");
  }

  const relPath = `state/digest/${today}.md`;
  await writeFileAtomic(resolve(digestDir, `${today}.md`), parts.join("\n"));
  emitActivity({ kind: "digest", label: `digest de ${today} gerado (${sections} seção(ões))`, path: relPath });
  return { relPath, sections };
}

export async function listDigests(): Promise<string[]> {
  if (!existsSync(digestDir)) return [];
  const files = await readdir(digestDir).catch(() => [] as string[]);
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ""))
    .sort()
    .reverse();
}

export async function readDigest(date: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const path = resolve(digestDir, `${date}.md`);
  if (!existsSync(path)) return null;
  return readFile(path, "utf-8");
}

brainSchedulers.register({
  name: "digest",
  at: DIGEST_AT,
  run: async () => {
    const { sections } = await generateDigest();
    return `${sections} seção(ões)`;
  },
});
