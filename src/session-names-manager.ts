import { query, execute } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

class SessionNamesManager {
  private names = new Map<string, string>();
  private userCounters = new Map<string, number>();

  async initialize(): Promise<void> {
    const nameRows = await query<(RowDataPacket & { session_id: string; name: string })[]>(
      "SELECT session_id, name FROM session_names",
    );
    for (const row of nameRows) {
      this.names.set(row.session_id, row.name);
    }

    const counterRows = await query<(RowDataPacket & { label: string; counter: number })[]>(
      "SELECT label, counter FROM session_name_counters",
    );
    for (const row of counterRows) {
      this.userCounters.set(row.label, row.counter);
    }
  }

  async reload(): Promise<void> {
    this.names.clear();
    this.userCounters.clear();
    await this.initialize();
  }

  getName(sessionId: string): string | undefined {
    return this.names.get(sessionId);
  }

  async setName(sessionId: string, name: string): Promise<void> {
    this.names.set(sessionId, name);
    await execute(
      "INSERT INTO session_names (session_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
      [sessionId, name],
    );
  }

  async getNextAutoName(username?: string): Promise<string> {
    const label = this.formatLabel(username);
    const counter = (this.userCounters.get(label) ?? 0) + 1;
    this.userCounters.set(label, counter);
    await execute(
      "INSERT INTO session_name_counters (label, counter) VALUES (?, ?) ON DUPLICATE KEY UPDATE counter = ?",
      [label, counter, counter],
    );
    return `${label} ${counter}`;
  }

  private formatLabel(username?: string): string {
    if (!username || username === "admin") return "Admin";
    if (username === "telegram") return "Telegram";
    if (username === "system") return "System";
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  getNames(sessionIds: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const sid of sessionIds) {
      const name = this.names.get(sid);
      if (name) result[sid] = name;
    }
    return result;
  }

  getAllNames(): Record<string, string> {
    return Object.fromEntries(this.names);
  }
}

export const sessionNamesManager = new SessionNamesManager();
