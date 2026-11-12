import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import { execute, getPool, query, toMySQLDatetime } from "../database.js";
import { isIntegrationProvider, type AccountIdentity, type IntegrationProvider } from "./providers.js";

export const ADMIN_OWNER_ID = "admin";

export interface IntegrationCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
}

export interface IntegrationAccount {
  id: string;
  ownerId: string;
  provider: IntegrationProvider;
  externalId: string;
  name: string;
  detail: string;
  clientId: string;
  credentials: IntegrationCredentials;
  reauthRequired: boolean;
  refreshedAt: string;
  createdAt: string;
}

export interface AgentIntegrationLink {
  id: string;
  agentName: string;
  provider: IntegrationProvider;
  accountId: string;
  createdAt: string;
}

interface StoredClient {
  provider: IntegrationProvider;
  clientId: string;
  redirectUri: string;
  information: OAuthClientInformationMixed;
}

export interface AccountInput {
  ownerId: string;
  provider: IntegrationProvider;
  identity: AccountIdentity;
  clientId: string;
  credentials: IntegrationCredentials;
}

export type CredentialDecision =
  | { kind: "keep" }
  | { kind: "refreshed"; credentials: IntegrationCredentials }
  | { kind: "reauth" };

export interface LockedCredentials {
  credentials: IntegrationCredentials;
  reauthRequired: boolean;
}

interface ClientRow extends RowDataPacket {
  provider: string;
  client_id: string;
  redirect_uri: string;
  client_information: string;
}

interface AccountRow extends RowDataPacket {
  id: string;
  owner_id: string;
  provider: string;
  external_id: string;
  name: string;
  detail: string;
  client_id: string;
  credentials: string;
  reauth_required: number;
  refreshed_at: Date | string;
  created_at: Date | string;
}

interface LinkRow extends RowDataPacket {
  id: string;
  agent_name: string;
  provider: string;
  account_id: string;
  created_at: Date | string;
}

const MAX_NAME_LENGTH = 255;
const MAX_DETAIL_LENGTH = 320;

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function now(): string {
  return new Date().toISOString();
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseCredentials(raw: string): IntegrationCredentials {
  const data = parseJson(raw);
  return {
    accessToken: typeof data.accessToken === "string" ? data.accessToken : "",
    refreshToken: typeof data.refreshToken === "string" && data.refreshToken ? data.refreshToken : null,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

function toAccount(row: AccountRow): IntegrationAccount | null {
  if (!isIntegrationProvider(row.provider)) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    externalId: row.external_id,
    name: row.name,
    detail: row.detail,
    clientId: row.client_id,
    credentials: parseCredentials(row.credentials),
    reauthRequired: Boolean(row.reauth_required),
    refreshedAt: isoDate(row.refreshed_at),
    createdAt: isoDate(row.created_at),
  };
}

function toLink(row: LinkRow): AgentIntegrationLink | null {
  if (!isIntegrationProvider(row.provider)) return null;
  return { id: row.id, agentName: row.agent_name, provider: row.provider, accountId: row.account_id, createdAt: isoDate(row.created_at) };
}

function toClient(row: ClientRow): StoredClient | null {
  if (!isIntegrationProvider(row.provider)) return null;
  const information = parseJson(row.client_information);
  if (typeof information.client_id !== "string") return null;
  return { provider: row.provider, clientId: row.client_id, redirectUri: row.redirect_uri, information: information as unknown as OAuthClientInformationMixed };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

class IntegrationStore {
  private clients: StoredClient[] = [];
  private accounts = new Map<string, IntegrationAccount>();
  private links = new Map<string, AgentIntegrationLink>();

  async initialize(): Promise<void> {
    const clientRows = await query<ClientRow[]>("SELECT provider, client_id, redirect_uri, client_information FROM integration_clients");
    const accountRows = await query<AccountRow[]>(
      `SELECT id, owner_id, provider, external_id, name, detail, client_id, credentials, reauth_required, refreshed_at, created_at
       FROM integration_accounts`,
    );
    const linkRows = await query<LinkRow[]>("SELECT id, agent_name, provider, account_id, created_at FROM agent_integrations ORDER BY created_at");
    this.clients = clientRows.map(toClient).filter(present);
    this.accounts = new Map(accountRows.map(toAccount).filter(present).map((account) => [account.id, account]));
    this.links = new Map(linkRows.map(toLink).filter(present).map((link) => [link.id, link]));
  }

  clientFor(provider: IntegrationProvider, redirectUri: string): OAuthClientInformationMixed | null {
    return this.clients.find((client) => client.provider === provider && client.redirectUri === redirectUri)?.information ?? null;
  }

  clientById(provider: IntegrationProvider, clientId: string): OAuthClientInformationMixed | null {
    return this.clients.find((client) => client.provider === provider && client.clientId === clientId)?.information ?? null;
  }

  async saveClient(provider: IntegrationProvider, redirectUri: string, information: OAuthClientInformationMixed): Promise<void> {
    await execute(
      "INSERT INTO integration_clients (provider, client_id, redirect_uri, client_information, created_at) VALUES (?, ?, ?, ?, ?)",
      [provider, information.client_id, redirectUri, JSON.stringify(information), toMySQLDatetime(now())],
    );
    this.clients.push({ provider, clientId: information.client_id, redirectUri, information });
  }

  getAccount(id: string): IntegrationAccount | undefined {
    return this.accounts.get(id);
  }

  allAccounts(): IntegrationAccount[] {
    return [...this.accounts.values()];
  }

  accountsOf(ownerId: string): IntegrationAccount[] {
    return this.allAccounts()
      .filter((account) => account.ownerId === ownerId)
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  }

  async saveAccount(input: AccountInput, existingId: string | null): Promise<IntegrationAccount> {
    const timestamp = toMySQLDatetime(now());
    const name = input.identity.name.slice(0, MAX_NAME_LENGTH);
    const detail = input.identity.detail.slice(0, MAX_DETAIL_LENGTH);
    const existing = existingId
      ? this.accounts.get(existingId)
      : this.allAccounts().find((account) => account.ownerId === input.ownerId && account.provider === input.provider && account.externalId === input.identity.externalId);
    if (existing) {
      await execute(
        `UPDATE integration_accounts
         SET external_id = ?, name = ?, detail = ?, client_id = ?, credentials = ?, reauth_required = 0, refreshed_at = ?, updated_at = ?
         WHERE id = ?`,
        [input.identity.externalId, name, detail, input.clientId, JSON.stringify(input.credentials), timestamp, timestamp, existing.id],
      );
      Object.assign(existing, {
        externalId: input.identity.externalId,
        name,
        detail,
        clientId: input.clientId,
        credentials: input.credentials,
        reauthRequired: false,
        refreshedAt: now(),
      });
      return existing;
    }
    const account: IntegrationAccount = {
      id: randomUUID(),
      ownerId: input.ownerId,
      provider: input.provider,
      externalId: input.identity.externalId,
      name,
      detail,
      clientId: input.clientId,
      credentials: input.credentials,
      reauthRequired: false,
      refreshedAt: now(),
      createdAt: now(),
    };
    await execute(
      `INSERT INTO integration_accounts
         (id, owner_id, provider, external_id, name, detail, client_id, credentials, reauth_required, refreshed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [account.id, account.ownerId, account.provider, account.externalId, name, detail, account.clientId, JSON.stringify(account.credentials), timestamp, timestamp, timestamp],
    );
    this.accounts.set(account.id, account);
    return account;
  }

  // Serializa a renovação entre processos (serviço e agendamentos headless): o refresh token do
  // Notion é rotacionado a cada uso e reapresentar um token antigo revoga a autorização inteira.
  async lockCredentials(id: string, decide: (current: LockedCredentials) => Promise<CredentialDecision>): Promise<LockedCredentials | null> {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<AccountRow[]>("SELECT credentials, reauth_required FROM integration_accounts WHERE id = ? FOR UPDATE", [id]);
      const row = rows[0];
      if (!row) {
        await conn.rollback();
        this.forgetAccount(id);
        return null;
      }
      const current: LockedCredentials = { credentials: parseCredentials(row.credentials), reauthRequired: Boolean(row.reauth_required) };
      const decision = await decide(current);
      const timestamp = toMySQLDatetime(now());
      let result = current;
      if (decision.kind === "refreshed") {
        await conn.execute(
          "UPDATE integration_accounts SET credentials = ?, reauth_required = 0, refreshed_at = ?, updated_at = ? WHERE id = ?",
          [JSON.stringify(decision.credentials), timestamp, timestamp, id],
        );
        result = { credentials: decision.credentials, reauthRequired: false };
      } else if (decision.kind === "reauth") {
        await conn.execute("UPDATE integration_accounts SET reauth_required = 1, updated_at = ? WHERE id = ?", [timestamp, id]);
        result = { credentials: current.credentials, reauthRequired: true };
      }
      await conn.commit();
      const cached = this.accounts.get(id);
      if (cached) {
        Object.assign(cached, result);
        if (decision.kind === "refreshed") cached.refreshedAt = now();
      }
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  async deleteAccount(id: string): Promise<void> {
    await execute("DELETE FROM integration_accounts WHERE id = ?", [id]);
    this.forgetAccount(id);
  }

  private forgetAccount(id: string): void {
    this.accounts.delete(id);
    for (const link of this.linksOfAccount(id)) this.links.delete(link.id);
  }

  getLink(id: string): AgentIntegrationLink | undefined {
    return this.links.get(id);
  }

  allLinks(): AgentIntegrationLink[] {
    return [...this.links.values()];
  }

  linksOf(agentName: string): AgentIntegrationLink[] {
    return this.allLinks().filter((link) => link.agentName === agentName);
  }

  linkOf(agentName: string, provider: IntegrationProvider): AgentIntegrationLink | undefined {
    return this.linksOf(agentName).find((link) => link.provider === provider);
  }

  linksOfAccount(accountId: string): AgentIntegrationLink[] {
    return this.allLinks().filter((link) => link.accountId === accountId);
  }

  async saveLink(agentName: string, account: IntegrationAccount): Promise<AgentIntegrationLink> {
    const previous = this.linkOf(agentName, account.provider);
    if (previous) await this.deleteLink(previous.id);
    const link: AgentIntegrationLink = { id: randomUUID(), agentName, provider: account.provider, accountId: account.id, createdAt: now() };
    await execute(
      "INSERT INTO agent_integrations (id, agent_name, provider, account_id, created_at) VALUES (?, ?, ?, ?, ?)",
      [link.id, agentName, link.provider, link.accountId, toMySQLDatetime(link.createdAt)],
    );
    this.links.set(link.id, link);
    return link;
  }

  async deleteLink(id: string): Promise<void> {
    await execute("DELETE FROM agent_integrations WHERE id = ?", [id]);
    this.links.delete(id);
  }
}

export const integrationStore = new IntegrationStore();
