import { randomBytes, randomUUID } from "node:crypto";
import { query, execute, getPool, toMySQLDatetime } from "./database.js";
import type { RowDataPacket } from "mysql2/promise";

export interface User {
  id: string;
  name: string;
  email: string;
  token: string;
  projects: string[];
  agents: string[];
  trackerProjects: string[];
  createdAt: string;
}

interface UserRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  token: string;
  created_at: string | Date;
}

class UsersManager {
  private users = new Map<string, User>();

  async initialize(): Promise<void> {
    await this.loadFromDb();
  }

  private async loadFromDb(): Promise<void> {
    this.users.clear();

    const rows = await query<UserRow[]>("SELECT id, name, email, token, created_at FROM users ORDER BY name");

    const projectRows = await query<(RowDataPacket & { user_id: string; project_name: string })[]>(
      "SELECT user_id, project_name FROM user_projects",
    );
    const agentRows = await query<(RowDataPacket & { user_id: string; agent_name: string })[]>(
      "SELECT user_id, agent_name FROM user_agents",
    );
    const trackerRows = await query<(RowDataPacket & { user_id: string; tracker_project_id: string })[]>(
      "SELECT user_id, tracker_project_id FROM user_tracker_projects",
    );

    const projectMap = new Map<string, string[]>();
    for (const r of projectRows) {
      const list = projectMap.get(r.user_id) ?? [];
      list.push(r.project_name);
      projectMap.set(r.user_id, list);
    }
    const agentMap = new Map<string, string[]>();
    for (const r of agentRows) {
      const list = agentMap.get(r.user_id) ?? [];
      list.push(r.agent_name);
      agentMap.set(r.user_id, list);
    }
    const trackerMap = new Map<string, string[]>();
    for (const r of trackerRows) {
      const list = trackerMap.get(r.user_id) ?? [];
      list.push(r.tracker_project_id);
      trackerMap.set(r.user_id, list);
    }

    for (const row of rows) {
      const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
      this.users.set(row.id, {
        id: row.id,
        name: row.name,
        email: row.email,
        token: row.token,
        projects: projectMap.get(row.id) ?? [],
        agents: agentMap.get(row.id) ?? [],
        trackerProjects: trackerMap.get(row.id) ?? [],
        createdAt,
      });
    }
  }

  async reload(): Promise<void> {
    await this.loadFromDb();
  }

  getAll(): User[] {
    return [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): User | undefined {
    return this.users.get(id);
  }

  async create(name: string, email: string): Promise<User> {
    const user: User = {
      id: randomUUID(),
      name,
      email,
      token: randomBytes(32).toString("base64url"),
      projects: [],
      agents: [],
      trackerProjects: [],
      createdAt: new Date().toISOString(),
    };

    await execute(
      "INSERT INTO users (id, name, email, token, created_at) VALUES (?, ?, ?, ?, ?)",
      [user.id, user.name, user.email, user.token, toMySQLDatetime(user.createdAt)],
    );

    this.users.set(user.id, user);
    return user;
  }

  async update(id: string, data: Partial<Pick<User, "name" | "email" | "projects" | "agents" | "trackerProjects">>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      if (data.name !== undefined) user.name = data.name;
      if (data.email !== undefined) user.email = data.email;
      await conn.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", [user.name, user.email, id]);

      if (data.projects !== undefined) {
        user.projects = data.projects;
        await conn.execute("DELETE FROM user_projects WHERE user_id = ?", [id]);
        for (const p of data.projects) {
          await conn.execute("INSERT INTO user_projects (user_id, project_name) VALUES (?, ?)", [id, p]);
        }
      }

      if (data.agents !== undefined) {
        user.agents = data.agents;
        await conn.execute("DELETE FROM user_agents WHERE user_id = ?", [id]);
        for (const a of data.agents) {
          await conn.execute("INSERT INTO user_agents (user_id, agent_name) VALUES (?, ?)", [id, a]);
        }
      }

      if (data.trackerProjects !== undefined) {
        user.trackerProjects = data.trackerProjects;
        await conn.execute("DELETE FROM user_tracker_projects WHERE user_id = ?", [id]);
        for (const tp of data.trackerProjects) {
          await conn.execute("INSERT INTO user_tracker_projects (user_id, tracker_project_id) VALUES (?, ?)", [id, tp]);
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return user;
  }

  findByToken(token: string): User | null {
    for (const user of this.users.values()) {
      if (user.token === token) return user;
    }
    return null;
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.users.delete(id);
    if (existed) {
      await execute("DELETE FROM users WHERE id = ?", [id]);
    }
    return existed;
  }
}

export const usersManager = new UsersManager();
