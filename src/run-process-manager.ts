import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { JsonPersister } from "./json-persister.js";
import { syncCaddyProxy } from "./caddy-proxy.js";

export interface RunConfig {
  id: string;
  name: string;
  command: string;
  workingDirectory: string;
  envVars: Record<string, string>;
  projectName: string;
  proxyDomain?: string;
  proxyPort?: number;
}

interface RunProcessState {
  configId: string;
  pid: number;
  startedAt: string;
}

interface ActiveProcess {
  process: ChildProcess;
  config: RunConfig;
  output: string;
}

const MAX_OUTPUT = 1024 * 1024;

class RunProcessManager extends EventEmitter {
  private configs = new Map<string, RunConfig>();
  private active = new Map<string, ActiveProcess>();
  private lastOutput = new Map<string, string>();
  private configsPersister = new JsonPersister(resolve(config.dataPath, "run-configs.json"), "run-configs");
  private shuttingDown = false;

  constructor() {
    super();
    this.setMaxListeners(50);
    this.loadConfigs();
    this.reconcileProcesses();
  }

  private loadConfigs(): void {
    const data = this.configsPersister.readSync() as RunConfig[] | null;
    if (!data) return;
    for (const c of data) {
      this.configs.set(c.id, c);
    }
  }

  reload(): void {
    this.configs.clear();
    this.loadConfigs();
  }

  private processesPath(): string {
    return resolve(config.dataPath, "run-processes.json");
  }

  private reconcileProcesses(): void {
    const path = this.processesPath();
    if (!existsSync(path)) return;
    try {
      const states: RunProcessState[] = JSON.parse(readFileSync(path, "utf-8"));
      const alive: RunProcessState[] = [];
      const toRestart: string[] = [];
      for (const state of states) {
        try {
          process.kill(state.pid, 0);
          alive.push(state);
        } catch {
          if (this.configs.has(state.configId)) {
            toRestart.push(state.configId);
          }
        }
      }
      this.persistProcesses(alive);

      if (toRestart.length > 0) {
        console.log(`[run-process] Restarting ${toRestart.length} previously running config(s)...`);
        for (const configId of toRestart) {
          const cfg = this.configs.get(configId);
          console.log(`[run-process] Auto-restarting: ${cfg?.name ?? configId}`);
          this.startProcess(configId);
        }
      }
    } catch {
    }
  }

  getAllConfigs(): RunConfig[] {
    return [...this.configs.values()];
  }

  getConfig(id: string): RunConfig | undefined {
    return this.configs.get(id);
  }

  createConfig(opts: Omit<RunConfig, "id">): RunConfig {
    const cfg: RunConfig = { ...opts, id: randomUUID() };
    this.configs.set(cfg.id, cfg);
    this.persistConfigs();
    return cfg;
  }

  updateConfig(id: string, updates: Partial<Omit<RunConfig, "id">>): RunConfig | null {
    const cfg = this.configs.get(id);
    if (!cfg) return null;
    Object.assign(cfg, updates);
    if (!cfg.proxyDomain) { delete cfg.proxyDomain; delete cfg.proxyPort; }
    this.persistConfigs();
    return cfg;
  }

  deleteConfig(id: string): boolean {
    if (this.active.has(id)) {
      this.stopProcess(id);
    }
    const deleted = this.configs.delete(id);
    if (deleted) this.persistConfigs();
    return deleted;
  }

  private persistConfigs(): void {
    this.configsPersister.scheduleWrite(() => this.getAllConfigs());
    syncCaddyProxy(this.getAllConfigs());
  }

  startProcess(configId: string): boolean {
    if (this.active.has(configId)) return false;
    const cfg = this.configs.get(configId);
    if (!cfg) return false;

    const env = { ...process.env, ...cfg.envVars };
    const cwd = cfg.workingDirectory || process.cwd();

    const child = spawn(cfg.command, {
      shell: true,
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const entry: ActiveProcess = { process: child, config: cfg, output: "" };
    this.active.set(configId, entry);
    this.lastOutput.delete(configId);

    const appendOutput = (chunk: string) => {
      entry.output += chunk;
      if (entry.output.length > MAX_OUTPUT) {
        entry.output = entry.output.slice(-MAX_OUTPUT);
      }
      this.emit("output", configId, chunk);
    };

    child.stdout?.on("data", (data: Buffer) => appendOutput(data.toString()));
    child.stderr?.on("data", (data: Buffer) => appendOutput(data.toString()));

    child.on("close", (code) => {
      this.lastOutput.set(configId, entry.output);
      this.active.delete(configId);
      if (!this.shuttingDown) this.persistProcessStates();
      this.emit("stop", configId, code ?? 0);
    });

    child.on("error", (err) => {
      this.lastOutput.set(configId, entry.output);
      this.active.delete(configId);
      if (!this.shuttingDown) this.persistProcessStates();
      this.emit("error", configId, err.message);
    });

    this.persistProcessStates();
    this.emit("start", configId, cfg);
    return true;
  }

  stopProcess(configId: string): boolean {
    const entry = this.active.get(configId);
    if (entry) {
      const pid = entry.process.pid;
      if (pid) {
        try { process.kill(-pid, "SIGTERM"); } catch { }
        setTimeout(() => {
          try { process.kill(-pid, "SIGKILL"); } catch { }
        }, 5000);
      } else {
        entry.process.kill("SIGTERM");
      }
      return true;
    }

    const orphanPid = this.findOrphanPid(configId);
    if (orphanPid) {
      try {
        process.kill(-orphanPid, "SIGTERM");
        setTimeout(() => {
          try { process.kill(-orphanPid, "SIGKILL"); } catch { }
        }, 5000);
      } catch { }
      this.persistProcessStates();
      this.emit("stop", configId, 0);
      return true;
    }

    return false;
  }

  restartProcess(configId: string): boolean {
    const hasOrphan = this.findOrphanPid(configId) !== null;
    const wasRunning = this.active.has(configId) || hasOrphan;
    if (wasRunning) {
      this.stopProcess(configId);
    }
    const entry = this.active.get(configId);
    if (entry) {
      entry.process.once("close", () => {
        this.startProcess(configId);
      });
    } else {
      setTimeout(() => this.startProcess(configId), wasRunning ? 1000 : 0);
    }
    return true;
  }

  private findOrphanPid(configId: string): number | null {
    const path = this.processesPath();
    if (!existsSync(path)) return null;
    try {
      const states: RunProcessState[] = JSON.parse(readFileSync(path, "utf-8"));
      const state = states.find((s) => s.configId === configId);
      if (!state) return null;
      process.kill(state.pid, 0);
      return state.pid;
    } catch {
      return null;
    }
  }

  isRunning(configId: string): boolean {
    return this.active.has(configId);
  }

  getOutput(configId: string): string {
    return this.active.get(configId)?.output ?? this.lastOutput.get(configId) ?? "";
  }

  getStatus(): Record<string, { running: boolean; pid?: number; startedAt?: string }> {
    const result: Record<string, { running: boolean; pid?: number; startedAt?: string }> = {};
    for (const [id] of this.configs) {
      const entry = this.active.get(id);
      result[id] = entry
        ? { running: true, pid: entry.process.pid }
        : { running: false };
    }

    const processesPath = this.processesPath();
    if (existsSync(processesPath)) {
      try {
        const states: RunProcessState[] = JSON.parse(readFileSync(processesPath, "utf-8"));
        for (const s of states) {
          if (result[s.configId] && !result[s.configId].running) {
            try {
              process.kill(s.pid, 0);
              result[s.configId] = { running: true, pid: s.pid, startedAt: s.startedAt };
            } catch { }
          }
        }
      } catch { }
    }

    return result;
  }

  private persistProcessStates(): void {
    const states: RunProcessState[] = [];
    for (const [configId, entry] of this.active) {
      if (entry.process.pid) {
        states.push({ configId, pid: entry.process.pid, startedAt: new Date().toISOString() });
      }
    }
    this.persistProcesses(states);
  }

  private persistProcesses(states: RunProcessState[]): void {
    const target = this.processesPath();
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(states, null, 2), "utf-8");
      renameSync(tmp, target);
    } catch (err) {
      console.error("[run-process] persist processes failed:", err);
    }
  }

  flush(): void {
    this.shuttingDown = true;
    this.configsPersister.flushSync(this.getAllConfigs());
  }
}

export const runProcessManager = new RunProcessManager();
