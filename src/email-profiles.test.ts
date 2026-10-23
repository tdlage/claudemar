import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  defaultSender,
  findSender,
  parseCredentials,
  profileError,
  profilesForRequester,
  serializeCredentials,
  type EmailProfile,
} from "./email-profiles.js";
import { requesterOf } from "./requester.js";

function profile(name: string, from: string, audience: EmailProfile["audience"], userId = ""): EmailProfile {
  return { name, awsAccessKeyId: "AKIA", awsSecretAccessKey: "secret", region: "us-east-1", from, senderName: "", audience, userId };
}

const shared = profile("default", "no-reply@claudemar.dev", "all");
const company = profile("company", "contato@empresa.com", "admin");
const ana = profile("ana", "ana@claudemar.dev", "user", "u-ana");
const bruno = profile("bruno", "bruno@claudemar.dev", "user", "u-bruno");
const all = [shared, company, ana, bruno];

test("perfis sem audience (anteriores ao controle de acesso) ficam só para o admin", () => {
  const [legacy] = parseCredentials("[default]\naws_access_key_id=AKIA\naws_secret_access_key=s\nregion=us-east-1\nfrom=no-reply@claudemar.dev\n");
  assert.equal(legacy.audience, "admin");
  assert.equal(legacy.userId, "");
});

test("serialize/parse preserva audience, usuário e nome do remetente", () => {
  const named = { ...ana, senderName: "Ana Souza" };
  assert.deepEqual(parseCredentials(serializeCredentials([shared, company, named])), [shared, company, named]);
});

test("user_id só vale para audience user e audience inválida cai para admin", () => {
  const [p] = parseCredentials("[x]\nfrom=x@y.com\naudience=all\nuser_id=u-ana\n");
  assert.equal(p.userId, "");
  const [q] = parseCredentials("[x]\nfrom=x@y.com\naudience=everyone\n");
  assert.equal(q.audience, "admin");
});

test("identidade: userId manda; sem ele só admin/sem username é admin", () => {
  assert.deepEqual(requesterOf("Ana", "u-ana"), { role: "user", userId: "u-ana" });
  assert.deepEqual(requesterOf(undefined, undefined), { role: "admin" });
  assert.deepEqual(requesterOf("admin", undefined), { role: "admin" });
  assert.deepEqual(requesterOf("schedule:abc", undefined), { role: "user", userId: null });
  assert.deepEqual(requesterOf("Ana", undefined), { role: "user", userId: null });
});

test("admin vê os remetentes de todos e os exclusivos do admin, não os de usuários", () => {
  assert.deepEqual(profilesForRequester(all, { role: "admin" }), [shared, company]);
});

test("usuário vê os de todos e apenas os do seu id; sem id conhecido, só os de todos", () => {
  assert.deepEqual(profilesForRequester(all, { role: "user", userId: "u-ana" }), [shared, ana]);
  assert.deepEqual(profilesForRequester(all, { role: "user", userId: null }), [shared]);
});

test("findSender ignora caixa e espaços", () => {
  assert.equal(findSender(all, "  Ana@Claudemar.dev "), ana);
  assert.equal(findSender([shared, ana], "contato@empresa.com"), undefined);
});

test("remetente padrão é o configurado se disponível, senão o único disponível", () => {
  assert.equal(defaultSender([shared, ana], "no-reply@claudemar.dev"), shared);
  assert.equal(defaultSender([shared, ana], "contato@empresa.com"), undefined);
  assert.equal(defaultSender([ana], "contato@empresa.com"), ana);
  assert.equal(defaultSender([shared, ana], ""), undefined);
});

test("profileError rejeita campos vazios, quebras de linha e audience incompleta", () => {
  assert.equal(profileError(shared), null);
  assert.match(profileError({ ...shared, region: "" }) ?? "", /required/);
  assert.match(profileError({ ...shared, awsAccessKeyId: "" }) ?? "", /required/);
  assert.match(profileError({ ...shared, from: "" }) ?? "", /from/);
  assert.match(profileError({ ...shared, from: "sem-arroba" }) ?? "", /from/);
  assert.match(profileError({ ...shared, senderName: "x\naudience=all" }) ?? "", /line breaks/);
  assert.match(profileError({ ...shared, name: "[a]" }) ?? "", /name/);
  assert.match(profileError({ ...ana, userId: "" }) ?? "", /user/);
});
