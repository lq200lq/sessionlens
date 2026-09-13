import { ingestSessionLog } from "@/lib/ingest";
import type { Session } from "@/lib/ingest/types";
import {
  findByHash,
  getStoredSession,
  putStoredSession,
  sha256Hex,
  type SessionOrigin,
} from "@/lib/storage";

export const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".next", "dist"]);
export const SESSION_NEST_DIRS = [".claude", ".codex"] as const;
export const MAX_PROJECT_JSONL = 500;
const MAX_DEPTH = 8;

export type FoundJsonl = { name: string; file: File };

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

export function isSessionHomeName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ".claude" || lower === ".codex" || lower === "projects" || lower === "sessions";
}

export function claudeDirMatchesHint(dirName: string, hint: string): boolean {
  const h = hint.trim();
  if (!h) return false;
  if (dirName === h) return true;
  return dirName.endsWith(`-${h}`) || dirName.endsWith(`-${h.replace(/\//g, "-")}`);
}

async function tryGetDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function collectJsonlRecursive(
  dir: FileSystemDirectoryHandle,
  acc: FoundJsonl[],
  depth: number,
): Promise<void> {
  if (acc.length >= MAX_PROJECT_JSONL || depth > MAX_DEPTH) return;
  for await (const [name, handle] of dir.entries()) {
    if (acc.length >= MAX_PROJECT_JSONL) break;
    if (handle.kind === "directory") {
      if (shouldSkipDir(name)) continue;
      await collectJsonlRecursive(handle as FileSystemDirectoryHandle, acc, depth + 1);
      continue;
    }
    if (!name.toLowerCase().endsWith(".jsonl")) continue;
    acc.push({ name, file: await (handle as FileSystemFileHandle).getFile() });
  }
}

async function collectJsonlShallow(dir: FileSystemDirectoryHandle, acc: FoundJsonl[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (acc.length >= MAX_PROJECT_JSONL) break;
    if (handle.kind === "directory" || !name.toLowerCase().endsWith(".jsonl")) continue;
    acc.push({ name, file: await (handle as FileSystemFileHandle).getFile() });
  }
}

async function listChildDirectories(dir: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle[]> {
  const out: FileSystemDirectoryHandle[] = [];
  for await (const [, handle] of dir.entries()) {
    if (handle.kind === "directory") out.push(handle as FileSystemDirectoryHandle);
  }
  return out;
}

async function resolveClaudeProjectsDir(dir: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  if (dir.name.toLowerCase() === "projects") return dir;
  if (dir.name.toLowerCase() === ".claude") return tryGetDirectory(dir, "projects");
  const dotClaude = await tryGetDirectory(dir, ".claude");
  if (dotClaude) return tryGetDirectory(dotClaude, "projects");
  return null;
}

async function resolveCodexSessionsDir(dir: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | null> {
  if (dir.name.toLowerCase() === "sessions" || dir.name.toLowerCase() === ".codex") return dir;
  const nested = await tryGetDirectory(dir, "sessions");
  if (nested) return nested;
  return tryGetDirectory(dir, ".codex");
}

async function jsonlInDir(dir: FileSystemDirectoryHandle): Promise<FoundJsonl[]> {
  const acc: FoundJsonl[] = [];
  await collectJsonlRecursive(dir, acc, 0);
  return acc;
}

export type SessionGroup = {
  name: string;
  handle: FileSystemDirectoryHandle;
  files: FoundJsonl[];
};

export async function expandSessionGroups(
  dir: FileSystemDirectoryHandle,
  hint?: string,
): Promise<SessionGroup[]> {
  const claudeRoot = await resolveClaudeProjectsDir(dir);
  if (claudeRoot) {
    const groups: SessionGroup[] = [];
    for (const child of await listChildDirectories(claudeRoot)) {
      if (hint && !claudeDirMatchesHint(child.name, hint)) continue;
      const files = await jsonlInDir(child);
      if (files.length) groups.push({ name: child.name, handle: child, files });
    }
    if (groups.length) return groups;
  }

  const codexRoot = await resolveCodexSessionsDir(dir);
  if (codexRoot && isSessionHomeName(dir.name)) {
    const files = await jsonlInDir(codexRoot);
    if (files.length) return [{ name: dir.name, handle: dir, files }];
  }

  const acc: FoundJsonl[] = [];
  if (isSessionHomeName(dir.name)) {
    await collectJsonlRecursive(dir, acc, 0);
  } else {
    await collectJsonlShallow(dir, acc);
    for (const nest of SESSION_NEST_DIRS) {
      const nested = await tryGetDirectory(dir, nest);
      if (nested) await collectJsonlRecursive(nested, acc, 0);
    }
  }
  if (acc.length) return [{ name: dir.name, handle: dir, files: acc }];
  return [];
}

export async function collectJsonlFromDirectory(dir: FileSystemDirectoryHandle): Promise<FoundJsonl[]> {
  const groups = await expandSessionGroups(dir);
  return groups.flatMap((group) => group.files);
}

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const pick = window.showDirectoryPicker;
  if (!pick) return null;
  try {
    return await pick({ mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export async function ensureDirectoryRead(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "read" as const };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

export async function storeJsonlText(
  input: { filename: string; text: string; byteLength: number },
  options: { origin: SessionOrigin; projectId?: string },
): Promise<{ ok: true; id: string; session: Session } | { ok: false; filename: string; error: string }> {
  const result = ingestSessionLog({
    filename: input.filename,
    text: input.text,
    byteLength: input.byteLength,
  });
  if (!result.ok) return { ok: false, filename: input.filename, error: result.error };

  const hash = await sha256Hex(input.text);
  const existing = await findByHash(hash);
  let id = existing?.id ?? result.session.id;
  const collision = await getStoredSession(id);
  if (collision && collision.contentHash !== hash) {
    id = `${id}-${hash.slice(0, 8)}`;
  }
  const now = new Date().toISOString();
  await putStoredSession({
    id,
    source: result.session.source,
    title: result.session.title,
    cwd: result.session.cwd,
    gitBranch: result.session.gitBranch,
    model: result.session.model,
    startedAt: result.session.startedAt,
    importedAt: existing?.importedAt ?? now,
    lastOpenedAt: existing?.lastOpenedAt ?? now,
    filename: input.filename,
    contentHash: hash,
    jsonl: input.text,
    subagent: result.session.subagent,
    origin: options.origin,
    projectId: options.projectId,
  });
  result.session.id = id;
  return { ok: true, id, session: result.session };
}

export async function importJsonlFiles(
  files: Array<{ name: string; text: () => Promise<string>; size: number }>,
  options: { origin: SessionOrigin; projectId?: string },
): Promise<{
  successes: { id: string; session: Session }[];
  failures: string[];
}> {
  const successes: { id: string; session: Session }[] = [];
  const failures: string[] = [];
  for (const file of files) {
    const text = await file.text();
    const stored = await storeJsonlText(
      { filename: file.name, text, byteLength: file.size },
      options,
    );
    if (!stored.ok) {
      failures.push(`${stored.filename}：${stored.error}`);
      continue;
    }
    successes.push({ id: stored.id, session: stored.session });
  }
  return { successes, failures };
}

export async function ingestSessionGroup(group: SessionGroup, projectId: string) {
  const files = group.files.map((item) => ({
    name: item.name,
    text: () => item.file.text(),
    size: item.file.size,
  }));
  return importJsonlFiles(files, { origin: "project", projectId });
}

export async function rescanProject(handle: FileSystemDirectoryHandle, projectId: string) {
  const found = await collectJsonlFromDirectory(handle);
  const files = found.map((item) => ({
    name: item.name,
    text: () => item.file.text(),
    size: item.file.size,
  }));
  return importJsonlFiles(files, { origin: "project", projectId });
}
