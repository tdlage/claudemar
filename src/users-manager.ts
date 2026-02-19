import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.js";

export interface User {
  id: string;
  name: string;
  email: string;
  token: string;
  projects: string[];
  agents: string[];
  createdAt: string;
}

const PERSIST_DEBOUNCE_MS = 1000;

class UsersManager {
  private users = new Map<string, User>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  private filePath(): string {
    return resolve(config.basePath, "users.json");
  }

  private load(): void {
    const path = this.filePath();
    if (!existsSync(path)) return;
    try {
      const data: User[] = JSON.parse(readFileSync(path, "utf-8"));
      let needsPersist = false;
      for (const u of data) {
        if (!u.token) {
          u.token = randomBytes(32).toString("base64url");
          needsPersist = true;
        }
        this.users.set(u.id, u);
      }
      if (needsPersist) this.schedulePersist();
    } catch {
      // corrupted, start fresh
    }
  }

  getAll(): User[] {
    return [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): User | undefined {
    return this.users.get(id);
  }

  create(name: string, email: string): User {
    const user: User = {
      id: randomUUID(),
      name,
      email,
      token: randomBytes(32).toString("base64url"),
      projects: [],
      agents: [],
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.schedulePersist();
    return user;
  }

  update(id: string, data: Partial<Pick<User, "name" | "email" | "projects" | "agents">>): User | null {
    const user = this.users.get(id);
    if (!user) return null;
    if (data.name !== undefined) user.name = data.name;
    if (data.email !== undefined) user.email = data.email;
    if (data.projects !== undefined) user.projects = data.projects;
    if (data.agents !== undefined) user.agents = data.agents;
    this.schedulePersist();
    return user;
  }

  findByToken(token: string): User | null {
    for (const user of this.users.values()) {
      if (user.token === token) return user;
    }
    return null;
  }

  delete(id: string): boolean {
    const deleted = this.users.delete(id);
    if (deleted) this.schedulePersist();
    return deleted;
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persist(): void {
    const data = this.getAll();
    const target = this.filePath();
    const tmp = target + ".tmp";
    writeFile(tmp, JSON.stringify(data, null, 2), "utf-8")
      .then(() => rename(tmp, target))
      .catch((err) => console.error("[users] persist failed:", err));
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const data = this.getAll();
    const target = this.filePath();
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmp, target);
    } catch (err) {
      console.error("[users] flush failed:", err);
    }
  }
}

export const usersManager = new UsersManager();
