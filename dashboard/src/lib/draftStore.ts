import type { ImageBlock } from "./imageBlock";
import type { PromptAttachment } from "./promptAttachment";

export interface ComposerDraft {
  text: string;
  images: ImageBlock[];
  files: PromptAttachment[];
}

type DraftPart = keyof ComposerDraft;

const DATABASE = "claudemar-composer";
const STORE = "drafts";
const PARTS: DraftPart[] = ["text", "images", "files"];

export const draftStorageAvailable = typeof indexedDB !== "undefined";

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!draftStorageAvailable) return Promise.reject(new Error("IndexedDB indisponível"));
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    database = null;
    throw error;
  });
  return database;
}

async function withStore(mode: IDBTransactionMode, action: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadDraft(key: string): Promise<Partial<ComposerDraft>> {
  const draft: Partial<ComposerDraft> = {};
  await withStore("readonly", (store) => {
    for (const part of PARTS) {
      const request = store.get(`${key}:${part}`);
      request.onsuccess = () => {
        if (request.result !== undefined) Object.assign(draft, { [part]: request.result });
      };
    }
  });
  return draft;
}

export function saveDraftPart<P extends DraftPart>(key: string, part: P, value: ComposerDraft[P]): Promise<void> {
  return withStore("readwrite", (store) => {
    if (value.length === 0) store.delete(`${key}:${part}`);
    else store.put(value, `${key}:${part}`);
  });
}
