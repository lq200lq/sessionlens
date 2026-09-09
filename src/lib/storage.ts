import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SessionSource } from "@/lib/ingest/types";

const DB_NAME = "sessionlens";
const DB_VERSION = 1;

export type StoredSession = {
  id: string;
  source: SessionSource;
  title: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  startedAt?: string;
  importedAt: string;
  lastOpenedAt: string;
  filename: string;
  contentHash: string;
  jsonl: string;
  subagent?: boolean;
};

interface SessionLensDB extends DBSchema {
  sessions: {
    key: string;
    value: StoredSession;
    indexes: { "by-opened": string; "by-hash": string };
  };
}

let dbPromise: Promise<IDBPDatabase<SessionLensDB>> | undefined;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<SessionLensDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("by-opened", "lastOpenedAt");
        store.createIndex("by-hash", "contentHash");
      },
    });
  }
  return dbPromise;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function listStoredSessions(): Promise<StoredSession[]> {
  const database = await db();
  const all = await database.getAll("sessions");
  return all.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function getStoredSession(id: string): Promise<StoredSession | undefined> {
  return (await db()).get("sessions", id);
}

export async function findByHash(hash: string): Promise<StoredSession | undefined> {
  return (await db()).getFromIndex("sessions", "by-hash", hash);
}

export async function putStoredSession(record: StoredSession): Promise<void> {
  await (await db()).put("sessions", record);
}

export async function deleteStoredSession(id: string): Promise<void> {
  await (await db()).delete("sessions", id);
}

export async function clearStoredSessions(): Promise<void> {
  await (await db()).clear("sessions");
}

export async function touchStoredSession(id: string): Promise<void> {
  const database = await db();
  const existing = await database.get("sessions", id);
  if (!existing) return;
  existing.lastOpenedAt = new Date().toISOString();
  await database.put("sessions", existing);
}
