import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { getClient } from "../memory/qdrant.js";
import { brainWriteLock, writeFileAtomic } from "./git.js";
import { brainOwnerCondition } from "./brain-index.js";
import type { BrainScope } from "./scope.js";
import { parseRawFile, parseWikiFile, serializeRawFile, serializeWikiFile } from "./frontmatter.js";
import { scanRawThreads } from "./raw-scan.js";
import { WIKI_DIRS } from "./wiki.js";
import { canonicalTenant, tenantDescendants, tenantRoot } from "./tenants.js";

export interface RewriteSummary {
  rawThreads: number;
  wikiPages: number;
}

async function rewriteWikiPages(scope: BrainScope, affected: Set<string>): Promise<number> {
  let touched = 0;
  for (const dir of WIKI_DIRS) {
    const abs = resolve(scope.wikiDir, dir);
    if (!existsSync(abs)) continue;
    const files = (await readdir(abs).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const path = resolve(abs, file);
      const parsed = parseWikiFile(await readFile(path, "utf-8"));
      if (!parsed) continue;
      if (!affected.has(parsed.frontmatter.tenant)) continue;
      parsed.frontmatter.tenant = await canonicalTenant(scope, parsed.frontmatter.tenant);
      parsed.frontmatter.tenant_root = await tenantRoot(scope, parsed.frontmatter.tenant);
      await writeFileAtomic(scope, path, serializeWikiFile(parsed.frontmatter, parsed.body));
      touched += 1;
    }
  }
  return touched;
}

async function rewriteRawThreads(scope: BrainScope, affected: Set<string>): Promise<number> {
  let touched = 0;
  for (const item of await scanRawThreads(scope)) {
    const path = resolve(scope.root, item.relPath);
    const parsed = parseRawFile(await readFile(path, "utf-8").catch(() => ""));
    if (!parsed) continue;
    const current = parsed.frontmatter.triage?.tenant ?? parsed.frontmatter.tenant;
    if (!affected.has(current)) continue;
    const canonical = await canonicalTenant(scope, current);
    parsed.frontmatter.tenant = canonical;
    if (parsed.frontmatter.triage) parsed.frontmatter.triage.tenant = canonical;
    await writeFileAtomic(scope, path, serializeRawFile(parsed.frontmatter, parsed.body));
    touched += 1;
  }
  return touched;
}

/**
 * Cada contexto afetado é reapontado para o SEU canônico atual: um filho reparentado continua
 * sendo ele mesmo, só muda de raiz — rotulá-lo com o destino da fusão apagaria a distinção.
 */
async function repointIndex(scope: BrainScope, affected: Set<string>): Promise<void> {
  const client = getClient();
  if (!client) return;
  for (const tenant of affected) {
    const canonical = await canonicalTenant(scope, tenant);
    const root = await tenantRoot(scope, canonical);
    await client
      .setPayload(config.qdrantCollection, {
        payload: { tenant: canonical, targetName: root },
        filter: {
          must: [brainOwnerCondition(scope), { key: "tenant", match: { value: tenant } }],
        },
        wait: true,
      })
      .catch(() => {});
  }
}

export async function rewriteTenantReferences(scope: BrainScope, affected: string[]): Promise<RewriteSummary> {
  const set = new Set<string>();
  for (const id of affected.filter(Boolean)) {
    for (const descendant of await tenantDescendants(scope, id)) set.add(descendant);
    set.add(id);
  }
  if (set.size === 0) return { rawThreads: 0, wikiPages: 0 };
  const summary = await brainWriteLock(scope, async () => ({
    rawThreads: await rewriteRawThreads(scope, set),
    wikiPages: await rewriteWikiPages(scope, set),
  }));
  await repointIndex(scope, set);
  return summary;
}
