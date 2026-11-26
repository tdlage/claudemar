export type KeyedLock = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function keyedLock(): KeyedLock {
  const locks = new Map<string, Promise<void>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const settled = run.then(() => undefined, () => undefined);
    locks.set(key, settled);
    void settled.then(() => {
      if (locks.get(key) === settled) locks.delete(key);
    });
    return run;
  };
}
