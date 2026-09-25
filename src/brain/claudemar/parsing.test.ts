import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { zstdCompressSync } from "node:zlib";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-cm-parsing-"));
process.env.REDIS_URL = "redis://127.0.0.1:63999";
const claudeHome = mkdtempSync(resolve(tmpdir(), "claude-cfg-"));
const codexHome = mkdtempSync(resolve(tmpdir(), "codex-home-"));
process.env.CLAUDE_CONFIG_DIR = claudeHome;
process.env.CODEX_HOME = codexHome;

const {
  claudeToolAction,
  commitMessageOf,
  patchActions,
  shellCommandText,
  splitFormattedOutput,
  summarizeActions,
} = await import("./actions.js");
const { cleanUserText, matchTurnsToPrompts, splitTurns } = await import("./transcript.js");
const { codexEntries, readCodexTranscript } = await import("./codex-transcript.js");
const { readClaudeTranscript } = await import("./claude-transcript.js");
const { commitEvent, parseGitLog, readCommits } = await import("./commits.js");
const { targetFromParticipants } = await import("./targets.js");
type Transcript = import("./transcript.js").Transcript;

after(() => {
  rmSync(claudeHome, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

test("ferramentas do Claude viram ações; leitura e busca são ignoradas", () => {
  assert.deepEqual(claudeToolAction("Edit", { file_path: "/p/src/a.ts" }), { kind: "edit", detail: "/p/src/a.ts" });
  assert.deepEqual(claudeToolAction("Write", { file_path: "/p/b.ts" }), { kind: "write", detail: "/p/b.ts" });
  assert.deepEqual(claudeToolAction("Bash", { command: "npm test" }), { kind: "command", detail: "npm test" });
  assert.deepEqual(claudeToolAction("Agent", { description: "explorar" }), { kind: "subagent", detail: "explorar" });
  assert.deepEqual(claudeToolAction("ExitPlanMode", { plan: "# Plano" }), { kind: "plan", detail: "# Plano" });
  assert.deepEqual(claudeToolAction("mcp__brain__brain_search", { query: "x" }), { kind: "tool", detail: "mcp__brain__brain_search" });
  assert.equal(claudeToolAction("Read", { file_path: "/p/a.ts" }), null);
  assert.equal(claudeToolAction("Grep", { pattern: "x" }), null);
});

test("linhas de ferramenta formatadas com ANSI saem do texto e viram ações", () => {
  const output =
    "Vou olhar.\n\x1b[36m\x1b[1m> Read\x1b[0m \x1b[90m/p/a.ts\x1b[0m\n" +
    "\n\x1b[36m\x1b[1m> Edit\x1b[0m \x1b[33m/p/a.ts\x1b[0m\n" +
    "\n\x1b[36m\x1b[1m> Bash\x1b[0m \x1b[2mgit commit -m \"feat: busca\"\x1b[0m\n" +
    "> citação em markdown continua no texto\nFeito.";
  const { text, actions } = splitFormattedOutput(output);
  assert.equal(text, "Vou olhar.\n\n> citação em markdown continua no texto\nFeito.");
  assert.deepEqual(actions, [
    { kind: "edit", detail: "/p/a.ts" },
    { kind: "command", detail: 'git commit -m "feat: busca"' },
  ]);
});

test("patches do Codex e comandos de shell", () => {
  const patch = "*** Begin Patch\n*** Add File: src/novo.ts\n+x\n*** Update File: src/a.ts\n@@\n*** Delete File: src/velho.ts\n*** End Patch";
  assert.deepEqual(patchActions(patch), [
    { kind: "write", detail: "src/novo.ts" },
    { kind: "edit", detail: "src/a.ts" },
    { kind: "delete", detail: "src/velho.ts" },
  ]);
  assert.equal(shellCommandText(["bash", "-lc", "npm run build"]), "npm run build");
  assert.equal(shellCommandText(["git", "status"]), "git status");
});

test("mensagem de commit sai de -m e de heredoc", () => {
  assert.equal(commitMessageOf('git add -A && git commit -m "fix: corrige cursor"'), "fix: corrige cursor");
  assert.equal(
    commitMessageOf("git commit -m \"$(cat <<'EOF'\nfeat(brain): canal claudemar\n\nCorpo\nEOF\n)\""),
    "feat(brain): canal claudemar",
  );
  assert.equal(commitMessageOf("git status"), null);
});

test("resumo de ações relativiza caminhos, lista commits e o último plano", () => {
  const summary = summarizeActions(
    [
      { kind: "write", detail: "/root/proj/src/novo.ts" },
      { kind: "edit", detail: "/root/proj/src/a.ts" },
      { kind: "edit", detail: "/root/proj/src/a.ts" },
      { kind: "command", detail: 'git commit -m "feat: x"' },
      { kind: "tool", detail: "mcp__brain__brain_search" },
      { kind: "tool", detail: "mcp__brain__brain_search" },
      { kind: "plan", detail: "Plano final" },
    ],
    "/root/proj",
  );
  assert.match(summary, /Arquivos criados\/reescritos \(1\): src\/novo\.ts/);
  assert.match(summary, /Arquivos editados \(1\): src\/a\.ts/);
  assert.match(summary, /Commits: "feat: x"/);
  assert.match(summary, /mcp__brain__brain_search ×2/);
  assert.match(summary, /Plano apresentado:\nPlano final/);
});

test("texto injetado no turno do usuário é descartado", () => {
  assert.equal(cleanUserText("<system-reminder>lembrete</system-reminder>\nfaça X"), "faça X");
  assert.equal(cleanUserText("<environment_context>\n<cwd>/x</cwd>\n</environment_context>"), "");
  assert.equal(cleanUserText("[Request interrupted by user]"), "");
  assert.equal(cleanUserText("# AGENTS.md instructions for /x\n\nregras"), "");
});

function transcript(entries: Transcript["entries"]): Transcript {
  return { runtime: "claude", sessionId: "s", cwd: null, entries };
}

test("turnos casam com as execuções em ordem; mensagens intermediárias ficam com a execução anterior", () => {
  const turns = splitTurns(
    transcript([
      { kind: "user", at: "2026-09-01T10:00:00.000Z", text: "implemente o conector do claudemar no second brain" },
      { kind: "assistant", at: "2026-09-01T10:01:00.000Z", text: "Começando." },
      { kind: "user", at: "2026-09-01T10:02:00.000Z", text: "use o SDK para ler as sessões" },
      { kind: "action", at: "2026-09-01T10:03:00.000Z", action: { kind: "edit", detail: "/p/a.ts" } },
      { kind: "assistant", at: "2026-09-01T10:04:00.000Z", text: "Feito." },
      { kind: "user", at: "2026-09-01T11:00:00.000Z", text: "sim" },
      { kind: "assistant", at: "2026-09-01T11:01:00.000Z", text: "Commit criado." },
      { kind: "user", at: "2026-09-01T12:00:00.000Z", text: "sim" },
      { kind: "assistant", at: "2026-09-01T12:01:00.000Z", text: "Push feito." },
    ]),
  );
  assert.equal(turns.length, 4);
  const matched = matchTurnsToPrompts(turns, [
    "implemente o conector do claudemar no second brain",
    "sim",
    "sim",
    "pedido que não está no transcript",
  ]);
  assert.equal(matched[0]?.followUps.length, 1);
  assert.deepEqual(matched[0]?.assistant, ["Começando.", "Feito."]);
  assert.deepEqual(matched[0]?.actions, [{ kind: "edit", detail: "/p/a.ts" }]);
  assert.deepEqual(matched[1]?.assistant, ["Commit criado."]);
  assert.deepEqual(matched[2]?.assistant, ["Push feito."]);
  assert.equal(matched[3], null);
});

test("prefixo curto não casa prompt diferente", () => {
  const turns = splitTurns(transcript([{ kind: "user", at: null, text: "simplifique o módulo de busca" }]));
  assert.deepEqual(matchTurnsToPrompts(turns, ["sim"]), [null]);
});

function rolloutLine(timestamp: string, type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return { timestamp, type, payload };
}

test("rollout legado do Codex usa user_message/agent_message e extrai patch e shell", () => {
  const lines = [
    rolloutLine("2026-09-02T09:00:00.000Z", "session_meta", { id: "abc", cwd: "/home/x/projects/p" }),
    rolloutLine("2026-09-02T09:00:01.000Z", "response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<environment_context>\n<cwd>/x</cwd>\n</environment_context>" }],
    }),
    rolloutLine("2026-09-02T09:00:01.000Z", "response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "corrija o bug do cursor" }],
    }),
    rolloutLine("2026-09-02T09:00:01.500Z", "event_msg", { type: "user_message", message: "corrija o bug do cursor" }),
    rolloutLine("2026-09-02T09:00:02.000Z", "response_item", {
      type: "function_call",
      name: "shell",
      arguments: JSON.stringify({ command: ["bash", "-lc", "npm test"] }),
      call_id: "c1",
    }),
    rolloutLine("2026-09-02T09:00:03.000Z", "response_item", {
      type: "custom_tool_call",
      name: "apply_patch",
      input: "*** Begin Patch\n*** Update File: src/cursor.ts\n*** End Patch",
      call_id: "c2",
    }),
    rolloutLine("2026-09-02T09:00:04.000Z", "response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Corrigido." }],
    }),
    rolloutLine("2026-09-02T09:00:04.100Z", "event_msg", { type: "agent_message", message: "Corrigido." }),
  ];
  const { cwd, entries } = codexEntries(lines);
  assert.equal(cwd, "/home/x/projects/p");
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["user", "action", "action", "assistant"],
  );
  assert.deepEqual(entries[1], { kind: "action", at: "2026-09-02T09:00:02.000Z", action: { kind: "command", detail: "npm test" } });
  assert.deepEqual(entries[2], { kind: "action", at: "2026-09-02T09:00:03.000Z", action: { kind: "edit", detail: "src/cursor.ts" } });
});

test("rollout paginado sem event_msg filtra contexto injetado das mensagens de usuário", () => {
  const { entries } = codexEntries([
    rolloutLine("2026-09-02T09:00:00.000Z", "response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "# AGENTS.md instructions for /x\n\n<INSTRUCTIONS>regras</INSTRUCTIONS>" }],
    }),
    rolloutLine("2026-09-02T09:00:01.000Z", "response_item", {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "instruções do sistema" }],
    }),
    rolloutLine("2026-09-02T09:00:02.000Z", "response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "liste os módulos" }],
    }),
    rolloutLine("2026-09-02T09:00:03.000Z", "response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "São três." }],
    }),
  ]);
  assert.deepEqual(entries, [
    { kind: "user", at: "2026-09-02T09:00:02.000Z", text: "liste os módulos" },
    { kind: "assistant", at: "2026-09-02T09:00:03.000Z", text: "São três." },
  ]);
});

test("rollouts do Codex são achados pelo thread id, inclusive compactados em .zst", async () => {
  const plainId = "0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee";
  const packedId = "0199ffff-bbbb-7ccc-8ddd-eeeeeeeeeeee";
  const dir = resolve(codexHome, "sessions", "2026", "09", "02");
  mkdirSync(dir, { recursive: true });
  const content = (id: string) =>
    [
      rolloutLine("2026-09-02T09:00:00.000Z", "session_meta", { id, cwd: "/home/x/agents/financeiro" }),
      rolloutLine("2026-09-02T09:00:01.000Z", "event_msg", { type: "user_message", message: `pedido ${id}` }),
      rolloutLine("2026-09-02T09:00:02.000Z", "event_msg", { type: "agent_message", message: "resposta" }),
    ]
      .map((l) => JSON.stringify(l))
      .join("\n");
  writeFileSync(resolve(dir, `rollout-2026-09-02T09-00-00-${plainId}.jsonl`), content(plainId));
  writeFileSync(resolve(dir, `rollout-2026-09-02T09-00-00-${packedId}.jsonl.zst`), zstdCompressSync(Buffer.from(content(packedId))));

  const plain = await readCodexTranscript(plainId.toUpperCase());
  assert.equal(plain?.cwd, "/home/x/agents/financeiro");
  assert.deepEqual(plain?.entries[0], { kind: "user", at: "2026-09-02T09:00:01.000Z", text: `pedido ${plainId}` });
  const packed = await readCodexTranscript(packedId);
  assert.equal(packed?.entries.length, 2);
  assert.equal(await readCodexTranscript("0199aaaa-0000-7000-8000-000000000000"), null);
});

test("sessões do Claude são lidas pelo SDK com horário, texto e ferramentas", async () => {
  const sessionId = "11111111-2222-4333-8444-555555555555";
  const project = resolve(claudeHome, "projects", "-tmp-demo");
  mkdirSync(project, { recursive: true });
  const base = { sessionId, cwd: "/tmp/demo", version: "2.0.0", isSidechain: false, userType: "external" };
  const lines = [
    { ...base, type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-09-20T10:00:00.000Z", message: { role: "user", content: "<system-reminder>x</system-reminder>implemente a busca" } },
    { ...base, type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-09-20T10:00:05.000Z", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Vou editar." }, { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/tmp/demo/src/a.ts" } }] } },
    { ...base, type: "user", uuid: "u2", parentUuid: "a1", timestamp: "2026-09-20T10:00:06.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    { ...base, type: "assistant", uuid: "a2", parentUuid: "u2", timestamp: "2026-09-20T10:00:09.000Z", message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Pronto." }] } },
  ];
  writeFileSync(resolve(project, `${sessionId}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const result = await readClaudeTranscript(sessionId);
  assert.deepEqual(result?.entries, [
    { kind: "user", at: "2026-09-20T10:00:00.000Z", text: "implemente a busca" },
    { kind: "assistant", at: "2026-09-20T10:00:05.000Z", text: "Vou editar." },
    { kind: "action", at: "2026-09-20T10:00:05.000Z", action: { kind: "edit", detail: "/tmp/demo/src/a.ts" } },
    { kind: "assistant", at: "2026-09-20T10:00:09.000Z", text: "Pronto." },
  ]);
  assert.equal(await readClaudeTranscript("99999999-2222-4333-8444-555555555555"), null);
});

test("git log é lido com arquivos e mensagem completa", async () => {
  const repo = mkdtempSync(resolve(tmpdir(), "cm-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  writeFileSync(resolve(repo, "a.ts"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat: primeira versão\n\nDetalhe do corpo");
  writeFileSync(resolve(repo, "a.ts"), "export const a = 2;\n");
  git("commit", "-q", "-am", "fix: valor");
  try {
    const commits = await readCommits(
      { target: { kind: "project", name: "p" }, name: ".", path: repo, remoteUrl: "" },
      "2000-01-01T00:00:00Z",
      null,
      10,
    );
    assert.equal(commits.length, 2);
    assert.equal(commits[0].message, "fix: valor");
    assert.deepEqual(commits[0].files, ["M a.ts"]);
    assert.equal(commits[1].message, "feat: primeira versão\n\nDetalhe do corpo");
    assert.deepEqual(commits[1].files, ["A a.ts"]);
    assert.equal(commits[1].author, "Dev");
    assert.deepEqual(parseGitLog("lixo sem formato"), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("saída de comandos '!' do Claude Code não vira pedido, nem sem tag de fechamento", () => {
  assert.equal(cleanUserText("<bash-input>cat .env</bash-input><bash-stdout>DB_PASS=x</bash-stdout>"), "");
  assert.equal(cleanUserText("veja isto <bash-stdout>DATABASE_URL=mysql://a:b@c"), "veja isto");
});

test("mensagens depois do fim da execução não são atribuídas a ela", () => {
  const turns = splitTurns(
    transcript([
      { kind: "user", at: "2026-09-01T10:00:00.000Z", text: "implemente o conector do claudemar no second brain" },
      { kind: "assistant", at: "2026-09-01T10:05:00.000Z", text: "Feito." },
      { kind: "user", at: "2026-09-01T12:00:00.000Z", text: "agora faça outra coisa bem diferente disso" },
      { kind: "assistant", at: "2026-09-01T12:05:00.000Z", text: "Outra coisa feita." },
    ]),
  );
  const [first] = matchTurnsToPrompts(turns, ["implemente o conector do claudemar no second brain"], ["2026-09-01T10:06:00.000Z"]);
  assert.deepEqual(first?.assistant, ["Feito."]);
  assert.equal(first?.followUps.length, 0);
});

test("autor de commit não consegue se passar por alvo do claudemar", () => {
  const event = commitEvent(
    { target: { kind: "project", name: "foo" }, name: ".", path: "/x", remoteUrl: "" },
    { hash: "a".repeat(40), author: "x", email: "claudemar:agent:acme", authoredAt: "2026-09-01T00:00:00.000Z", committedAt: "2026-09-01T00:00:00.000Z", message: "m", files: [] },
  );
  assert.deepEqual(targetFromParticipants(event.participants), { kind: "project", name: "foo" });
  assert.equal(event.participants[1].handle, "git:claudemar:agent:acme");
});
