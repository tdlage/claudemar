import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.ALLOWED_CHAT_ID ??= "1";
process.env.CLAUDEMAR_DATA ??= mkdtempSync(resolve(tmpdir(), "claudemar-test-"));
process.env.BRAIN_ROOT ??= mkdtempSync(resolve(tmpdir(), "brain-cm-redact-"));

const { REDACTED, maskPersonalData, redactDeep, redactSecrets } = await import("./redact.js");

test("valores de segredos configurados somem do texto", () => {
  const out = redactSecrets("a senha do banco é s3nh4-do-banco-x e o token tk-agente-123456", [
    "s3nh4-do-banco-x",
    "tk-agente-123456",
  ]);
  assert.equal(out, `a senha do banco é ${REDACTED} e o token ${REDACTED}`);
});

test("formatos conhecidos de token são omitidos", () => {
  const samples = [
    "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "xoxb-1234567890-abcdefghijkl",
    "AKIAABCDEFGHIJKLMNOP",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "cmb_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
  ];
  for (const sample of samples) {
    assert.equal(redactSecrets(`antes ${sample} depois`, []), `antes ${REDACTED} depois`, sample);
  }
});

test("atribuições de variáveis sensíveis perdem o valor, o nome fica", () => {
  const env = "OPENAI_API_KEY=abc123def456ghi\nMYSQL_PASSWORD='SenhaForte9'\nTOKEN_ROTATION_HOURS=24\nDEBUG=true";
  assert.equal(
    redactSecrets(env, []),
    `OPENAI_API_KEY=${REDACTED}\nMYSQL_PASSWORD='${REDACTED}'\nTOKEN_ROTATION_HOURS=24\nDEBUG=true`,
  );
  assert.equal(redactSecrets('{"password": "hunter2hunter2"}', []), `{"password": "${REDACTED}"}`);
  assert.equal(redactSecrets("apiKey: process.env.JEV_API_KEY", []), "apiKey: process.env.JEV_API_KEY");
  assert.equal(redactSecrets("a variável BRAIN_ANTHROPIC_API_KEY guarda a chave", []), "a variável BRAIN_ANTHROPIC_API_KEY guarda a chave");
  assert.equal(redactSecrets("totalTokens: 12345678", []), "totalTokens: 12345678");
});

test("redação profunda alcança todas as strings antes de qualquer truncamento", () => {
  const redact = (text: string) => redactSecrets(text, ["SenhaDoAgente-987654321"]);
  const turn = {
    prompt: { at: null, text: "a senha é SenhaDoAgente-987654321" },
    followUps: [{ at: "2026-09-20T10:00:00.000Z", text: "ok" }],
    actions: [{ kind: "command", detail: "export DB_PASSWORD=SenhaDoAgente-987654321" }],
    startedAt: null,
  };
  const out = redactDeep(turn, redact);
  assert.equal(out.prompt.text, `a senha é ${REDACTED}`);
  assert.equal(out.actions[0].detail, `export DB_PASSWORD=${REDACTED}`);
  assert.equal(out.followUps[0].at, "2026-09-20T10:00:00.000Z");
  assert.equal(out.startedAt, null);
});

test("credenciais em headers, URLs, linha de comando, JSON e chaves privadas truncadas são omitidas", () => {
  const cases: [string, string][] = [
    ['curl -H "Authorization: Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a0"', `curl -H "Authorization: ${REDACTED}"`],
    ["DATABASE_URL=mysql://root:S3nh4Forte@db:3306/app", `DATABASE_URL=mysql://root:${REDACTED}@db:3306/app`],
    ["curl -u admin:S3nh4Forte http://127.0.0.1:3010/status", `curl -u admin:${REDACTED} http://127.0.0.1:3010/status`],
    ["mysql -u root -pS3nh4Forte2026", `mysql -u root -p${REDACTED}`],
    ["redis-cli -h cache -a MyRedisPass123", `redis-cli -h cache -a ${REDACTED}`],
    ['{"DB_PASSWORD": "S3nhaForte123"}', `{"DB_PASSWORD": "${REDACTED}"}`],
    ["senha: MinhaSenha2026", `senha: ${REDACTED}`],
    ["MYSQL_PASSWORD=correcthorsebattery", `MYSQL_PASSWORD=${REDACTED}`],
    ["aws configure set aws_secret_access_key wJalrXUtnFEMIK7MDENGbPxRfiCY", `aws configure set aws_secret_access_key ${REDACTED}`],
    ["chave xai-AbCdEfGhIjKlMnOpQrStUvWxYz0123 e sk_live_51HxAbCdEfGhIjKl", `chave ${REDACTED} e ${REDACTED}`],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n...(truncated)", REDACTED],
  ];
  for (const [input, expected] of cases) assert.equal(redactSecrets(input, []), expected, input);
  for (const keep of ["mkdir -p /tmp/x && ls -al", "totalTokens: 12345678", "Keyboard layout pt-br", 'git commit -am "fix"']) {
    assert.equal(redactSecrets(keep, []), keep, keep);
  }
});

test("entradas maliciosas não travam a redação", () => {
  for (const input of ["KEY".repeat(100_000), "eyJ-".repeat(64_000), "-----BEGIN RSA PRIVATE KEY-----\n".repeat(10_000)]) {
    const started = Date.now();
    redactSecrets(input, []);
    assert.ok(Date.now() - started < 2000, `${input.slice(0, 8)} levou ${Date.now() - started}ms`);
  }
});

test("dados pessoais somem dos trechos exibidos nas páginas", () => {
  assert.equal(
    maskPersonalData("João, CPF 123.456.789-00, joao@exemplo.com, tel (11) 99999-0000"),
    "João, CPF [cpf], [email], tel [telefone]",
  );
});
