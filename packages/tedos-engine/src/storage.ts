import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Storage is a tiny key -> JSON value store.
 *
 * Synchronous, like the rest of the engine. Persistence is an edge
 * concern: the orchestration loads state on startup and saves it after a
 * run. The kernel never sees it.
 */
export interface Storage {
  load<T>(key: string): T | null;
  save<T>(key: string, value: T): void;
}

/**
 * InMemoryStorage keeps values in a Map for the life of the process.
 *
 * It is the default when no storage path is configured — the original
 * in-memory behaviour, just behind the Storage interface. It does not
 * survive a restart.
 */
export class InMemoryStorage implements Storage {
  private readonly data = new Map<string, unknown>();

  load<T>(key: string): T | null {
    return this.data.has(key) ? (this.data.get(key) as T) : null;
  }

  save<T>(key: string, value: T): void {
    this.data.set(key, value);
  }
}

/**
 * JsonFileStorage persists each key as one JSON file under a root dir.
 *
 * Simple and dependency-free: read the file if it exists, write it on
 * save. State survives restarts.
 */
export class JsonFileStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private file(key: string): string {
    return join(this.root, `${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
  }

  load<T>(key: string): T | null {
    const path = this.file(key);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }

  save<T>(key: string, value: T): void {
    writeFileSync(this.file(key), JSON.stringify(value, null, 2), "utf8");
  }
}

/**
 * Build the configured storage. Persistence is opt-in: set
 * TEDOS_STORAGE_PATH to use JSON files; otherwise stay in memory.
 */
export function createStorage(): Storage {
  const path = process.env.TEDOS_STORAGE_PATH;
  return path ? new JsonFileStorage(path) : new InMemoryStorage();
}
