import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";

export interface User {
  id: string;
  name: string;
  email: string;
  token: string;
  projects: string[];
  agents: string[];
  createdAt: string;
}

class UsersManager {
  private users = new Map<string, User>();
  private persister = new JsonPersister(resolve(config.dataPath, "users.json"), "users");

  constructor() {
    this.applyFromDisk();
  }

  private applyFromDisk(): void {
    const data = this.persister.readSync() as User[] | null;
    if (!data) return;
    let needsPersist = false;
    for (const u of data) {
      if (!u.token) {
        u.token = randomBytes(32).toString("base64url");
        needsPersist = true;
      }
      this.users.set(u.id, u);
    }
    if (needsPersist) this.persister.scheduleWrite(() => this.getAll());
  }

  reload(): void {
    this.users.clear();
    this.applyFromDisk();
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
    this.persister.scheduleWrite(() => this.getAll());
    return user;
  }

  update(id: string, data: Partial<Pick<User, "name" | "email" | "projects" | "agents">>): User | null {
    const user = this.users.get(id);
    if (!user) return null;
    if (data.name !== undefined) user.name = data.name;
    if (data.email !== undefined) user.email = data.email;
    if (data.projects !== undefined) user.projects = data.projects;
    if (data.agents !== undefined) user.agents = data.agents;
    this.persister.scheduleWrite(() => this.getAll());
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
    if (deleted) this.persister.scheduleWrite(() => this.getAll());
    return deleted;
  }

  flush(): void {
    this.persister.flushSync(this.getAll());
  }
}

export const usersManager = new UsersManager();
