import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";

const DEBOUNCE_MS = 1000;

export class JsonPersister {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(
    private readonly path: string,
    private readonly prefix: string,
  ) {}

  readSync(): unknown | null {
    if (!existsSync(this.path)) return null;
    try {
      return JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      return null;
    }
  }

  scheduleWrite(getData: () => unknown): void {
    this.pending = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = false;
      const tmp = this.path + ".tmp";
      writeFile(tmp, JSON.stringify(getData(), null, 2), "utf-8")
        .then(() => rename(tmp, this.path))
        .catch((err) => {
          this.pending = true;
          console.error(`[${this.prefix}] persist failed:`, err);
        });
    }, DEBOUNCE_MS);
  }

  /**
   * Sem alteração pendente não reescreve: gravar o snapshot em memória por cima destruiria,
   * em silêncio, qualquer edição feita no arquivo enquanto o processo rodava.
   */
  flushSync(data: unknown): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    this.pending = false;
    const tmp = this.path + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      renameSync(tmp, this.path);
    } catch (err) {
      console.error(`[${this.prefix}] flush failed:`, err);
    }
  }
}
