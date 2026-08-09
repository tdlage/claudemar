import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-distill-test-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";

const { distillGateAction, groupCandidates } = await import("./distill.js");
type DistillCandidate = import("./distill.js").DistillCandidate;

test("gate bifásico: transições de estado", () => {
  assert.equal(distillGateAction(null, "2026-08-09"), "run");
  assert.equal(distillGateAction("2026-08-08", "2026-08-09"), "run");
  assert.equal(distillGateAction("2026-08-09:distilled", "2026-08-09"), "apply-pending");
  assert.equal(distillGateAction("2026-08-09", "2026-08-09"), "skip");
  assert.equal(distillGateAction("2026-08-08:distilled", "2026-08-09"), "run");
});

function candidate(
  n: number,
  tenant: "personal" | "biosoft",
  project: string,
  occurredTo = `2026-08-${String((n % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
): DistillCandidate {
  return { relPath: `raw/email/2026/08/t${n}.md`, threadKey: `k${n}`, tenant, project, occurredTo };
}

test("agrupamento por tenant+projeto com tetos", () => {
  const candidates: DistillCandidate[] = [];
  for (let i = 0; i < 12; i++) candidates.push(candidate(i, "personal", "geral"));
  for (let i = 12; i < 15; i++) candidates.push(candidate(i, "biosoft", "erp"));
  candidates.push(candidate(20, "personal", "erp"));

  const groups = groupCandidates(candidates);
  assert.equal(groups.length, 3);
  const geral = groups.find((g) => g.project === "geral" && g.tenant === "personal")!;
  assert.equal(geral.threads.length, 8);
  const erpBiosoft = groups.find((g) => g.tenant === "biosoft")!;
  assert.equal(erpBiosoft.threads.length, 3);
  assert.equal(groups.find((g) => g.project === "erp" && g.tenant === "personal")!.threads.length, 1);
});

test("grupos mais antigos têm prioridade e o corte é em 5", () => {
  const candidates: DistillCandidate[] = [];
  for (let p = 0; p < 8; p++) {
    const day = String(20 - p).padStart(2, "0");
    for (let i = 0; i <= p; i++) {
      candidates.push(candidate(p * 100 + i, "personal", `proj-${p}`, `2026-08-${day}T10:00:00.000Z`));
    }
  }
  const groups = groupCandidates(candidates);
  assert.equal(groups.length, 5);
  assert.equal(groups[0].project, "proj-7");
  assert.equal(groups[4].project, "proj-3");
});
