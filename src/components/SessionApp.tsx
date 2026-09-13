"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, FileUp, Menu, Trash2, X } from "lucide-react";
import { initialTurnId, importSummary } from "@/lib/display";
import { ingestSessionLog } from "@/lib/ingest";
import type { Session } from "@/lib/ingest/types";
import { cwdShortName, humanizeSessionText } from "@/lib/ingest/util";
import {
  canPickDirectory,
  ensureDirectoryRead,
  expandSessionGroups,
  importJsonlFiles,
  ingestSessionGroup,
  pickProjectDirectory,
  rescanProject,
  type SessionGroup,
} from "@/lib/projects";
import {
  clearImportedSessions,
  deleteSessionsForProject,
  deleteStoredProject,
  deleteStoredSession,
  getStoredSession,
  listStoredProjects,
  listStoredSessions,
  putStoredProject,
  sessionOrigin,
  touchStoredSession,
  type StoredProject,
  type StoredSession,
} from "@/lib/storage";
import { MOTION, gsap, prefersReducedMotion, useGSAP } from "@/lib/motion";
import { SourceBadge } from "./SourceBadge";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline, matchesFilter, type Filter } from "./Timeline";
import { DetailPane, SummaryBar, TaskPanel } from "./DetailPane";

function setQueryId(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("s", id);
  else url.searchParams.delete("s");
  window.history.replaceState(null, "", url.toString());
}

type Pane = "turns" | "internals";
type LibraryTab = "projects" | "imports";

export function SessionApp() {
  const [library, setLibrary] = useState<StoredSession[]>([]);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [projectAccess, setProjectAccess] = useState<Record<string, boolean>>({});
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("projects");
  const [pendingProjectHint, setPendingProjectHint] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [pane, setPane] = useState<Pane>("turns");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const skipDrawerAnim = useRef(true);

  const reloadLibrary = useCallback(async () => {
    setLibrary(await listStoredSessions());
    setProjects(await listStoredProjects());
  }, []);

  const openStored = useCallback(async (id: string, ingested?: Session) => {
    const record = await getStoredSession(id);
    if (!record && !ingested) return;
    let next = ingested;
    if (!next && record) {
      const result = ingestSessionLog({
        filename: record.filename,
        text: record.jsonl,
        byteLength: new TextEncoder().encode(record.jsonl).length,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      next = result.session;
    }
    if (!next) return;
    next.id = id;
    await touchStoredSession(id);
    next.lastOpenedAt = new Date().toISOString();
    setSession(next);
    setSelectedTurn(initialTurnId(next.turns));
    setPane("turns");
    setFilter("all");
    setWarnings(next.warnings);
    setError(null);
    setQueryId(id);
    setDrawerOpen(false);
    await reloadLibrary();
  }, [reloadLibrary]);

  const applyImportResult = async (
    successes: { id: string; session: Session }[],
    failures: string[],
    openLast: boolean,
  ) => {
    await reloadLibrary();
    if (openLast && successes.length) {
      const last = successes.at(-1)!;
      await openStored(last.id, last.session);
      setImportNote(importSummary(last.session.turns));
    }
    setWarnings(successes.flatMap((item) => item.session.warnings));
    if (!successes.length && failures.length) setError(failures.join("\n"));
    else if (failures.length) setError(failures.join("\n"));
  };

  const resyncProjects = useCallback(async () => {
    const items = await listStoredProjects();
    const access: Record<string, boolean> = {};
    for (const project of items) {
      const ok = await ensureDirectoryRead(project.handle);
      if (!ok) {
        access[project.id] = false;
        continue;
      }
      const { successes } = await rescanProject(project.handle, project.id);
      if (!successes.length) {
        await deleteSessionsForProject(project.id);
        await deleteStoredProject(project.id);
        continue;
      }
      access[project.id] = true;
    }
    setProjectAccess(access);
    setProjects(await listStoredProjects());
    setLibrary(await listStoredSessions());
  }, []);

  useEffect(() => {
    void (async () => {
      await reloadLibrary();
      const storedProjects = await listStoredProjects();
      const storedSessions = await listStoredSessions();
      if (
        storedProjects.length === 0 &&
        storedSessions.some((item) => sessionOrigin(item) === "import")
      ) {
        setLibraryTab("imports");
      }
      await resyncProjects();
      const id = new URLSearchParams(window.location.search).get("s");
      if (id) await openStored(id);
    })();
  }, [openStored, reloadLibrary, resyncProjects]);

  const importFiles = async (fileList: FileList | File[]) => {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const { successes, failures } = await importJsonlFiles(files, { origin: "import" });
      await applyImportResult(successes, failures, true);
    } finally {
      setBusy(false);
      setDragging(false);
      dragDepth.current = 0;
    }
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (hasFiles(event)) setDragging(true);
    };
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current += 1;
      if (hasFiles(event)) setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDropNative = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (busy) return;
      if (event.dataTransfer?.files?.length) void importFiles(event.dataTransfer.files);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDropNative);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDropNative);
    };
  }, [busy]);

  const removeOne = async (id: string) => {
    await deleteStoredSession(id);
    if (session?.id === id) {
      setSession(null);
      setQueryId(null);
      setImportNote(null);
    }
    await reloadLibrary();
  };

  const removeAllImported = async () => {
    if (!confirm("清空已导入的会话？项目里的会话不会删除。")) return;
    await clearImportedSessions();
    if (session && library.some((item) => item.id === session.id && sessionOrigin(item) === "import")) {
      setSession(null);
      setQueryId(null);
      setImportNote(null);
    }
    await reloadLibrary();
  };

  const commitSessionGroups = async (groups: SessionGroup[], openLast: boolean) => {
    const allSuccesses: { id: string; session: Session }[] = [];
    const allFailures: string[] = [];
    for (const group of groups) {
      let matched: StoredProject | undefined;
      for (const project of projects) {
        if (await project.handle.isSameEntry(group.handle)) {
          matched = project;
          break;
        }
      }
      const record =
        matched ??
        ({
          id: crypto.randomUUID(),
          name: group.name,
          handle: group.handle,
          addedAt: new Date().toISOString(),
        } satisfies StoredProject);
      const { successes, failures } = await ingestSessionGroup(group, record.id);
      allFailures.push(...failures);
      if (!successes.length) {
        await deleteSessionsForProject(record.id);
        continue;
      }
      const label = cwdShortName(successes[0]?.session.cwd) ?? group.name;
      if (!matched) await putStoredProject({ ...record, name: label });
      setProjectAccess((prev) => ({ ...prev, [record.id]: true }));
      allSuccesses.push(...successes);
    }
    if (!allSuccesses.length) {
      setImportNote("这个目录里没有会话 jsonl，未加入项目。");
      if (allFailures.length) setError(allFailures.join("\n"));
      await reloadLibrary();
      return;
    }
    setPendingProjectHint(null);
    await applyImportResult(allSuccesses, allFailures, openLast);
  };

  const addProject = async () => {
    const handle = await pickProjectDirectory();
    if (!handle) return;
    setBusy(true);
    setError(null);
    try {
      const granted = await ensureDirectoryRead(handle);
      if (!granted) {
        setError("需要授权后才能读取这个目录");
        return;
      }
      const groups = await expandSessionGroups(handle);
      if (!groups.length) {
        setPendingProjectHint(handle.name);
        setLibraryTab("projects");
        setImportNote(
          `「${handle.name}」仓库里没有会话文件（Claude 实际在 ~/.claude/projects/）。请点「绑定 .claude / .codex」再选一次。`,
        );
        return;
      }
      setLibraryTab("projects");
      await commitSessionGroups(groups, true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法打开这个目录");
    } finally {
      setBusy(false);
    }
  };

  const bindSessionHome = async () => {
    const handle = await pickProjectDirectory();
    if (!handle) return;
    setBusy(true);
    setError(null);
    try {
      const granted = await ensureDirectoryRead(handle);
      if (!granted) {
        setError("需要授权后才能读取这个目录");
        return;
      }
      const groups = await expandSessionGroups(handle, pendingProjectHint ?? undefined);
      if (!groups.length) {
        setImportNote(
          pendingProjectHint
            ? `在所选目录里没有找到「${pendingProjectHint}」的会话。请选 ~/.claude 或 ~/.claude/projects。`
            : "这个目录里没有会话 jsonl，未加入项目。",
        );
        return;
      }
      setLibraryTab("projects");
      await commitSessionGroups(groups, true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法打开这个目录");
    } finally {
      setBusy(false);
    }
  };

  const authorizeProject = async (project: StoredProject) => {
    const granted = await ensureDirectoryRead(project.handle);
    setProjectAccess((prev) => ({ ...prev, [project.id]: granted }));
    if (!granted) return;
    setBusy(true);
    try {
      const { successes, failures } = await rescanProject(project.handle, project.id);
      if (!successes.length) {
        await removeProject(project);
        setImportNote("这个目录里没有会话 jsonl，未加入项目。");
        if (failures.length) setError(failures.join("\n"));
        return;
      }
      await applyImportResult(successes, failures, false);
    } finally {
      setBusy(false);
    }
  };

  const removeProject = async (project: StoredProject) => {
    const removedIds = await deleteSessionsForProject(project.id);
    await deleteStoredProject(project.id);
    if (session && removedIds.includes(session.id)) {
      setSession(null);
      setQueryId(null);
      setImportNote(null);
    }
    await reloadLibrary();
  };

  const importedSessions = useMemo(
    () => library.filter((item) => sessionOrigin(item) === "import"),
    [library],
  );
  const projectSessionMap = useMemo(() => {
    const map = new Map<string, StoredSession[]>();
    for (const item of library) {
      if (sessionOrigin(item) !== "project" || !item.projectId) continue;
      const list = map.get(item.projectId) ?? [];
      list.push(item);
      map.set(item.projectId, list);
    }
    return map;
  }, [library]);

  const visibleTurns = useMemo(() => {
    if (!session) return [];
    return session.turns.filter((turn) => matchesFilter(turn, filter));
  }, [session, filter]);

  const filterCounts = useMemo(() => {
    const turns = session?.turns ?? [];
    return {
      all: turns.length,
      user: turns.filter((t) => t.role === "user").length,
      tools: turns.filter((t) => t.tools.length > 0).length,
      errors: turns.filter((t) => t.tools.some((tool) => tool.isError || (tool.exitCode != null && tool.exitCode !== 0)))
        .length,
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (selectedTurn && visibleTurns.some((turn) => turn.id === selectedTurn)) return;
    setSelectedTurn(visibleTurns[0]?.id);
  }, [filter, session, selectedTurn, visibleTurns]);

  const selected = useMemo(
    () => session?.turns.find((t) => t.id === selectedTurn) ?? session?.turns[0],
    [session, selectedTurn],
  );

  useGSAP(() => {
    const aside = asideRef.current;
    const backdrop = backdropRef.current;
    if (!aside) return;

    const desktop = window.matchMedia("(min-width: 768px)").matches;
    const reduce = prefersReducedMotion();

    if (desktop) {
      gsap.set(aside, { clearProps: "transform,x,xPercent,opacity,visibility" });
      if (backdrop) gsap.set(backdrop, { autoAlpha: 0 });
      return;
    }

    const instant = skipDrawerAnim.current;
    skipDrawerAnim.current = false;

    if (instant) {
      if (backdrop) gsap.set(backdrop, { autoAlpha: drawerOpen ? 1 : 0 });
      if (reduce) gsap.set(aside, { autoAlpha: drawerOpen ? 1 : 0, xPercent: 0 });
      else gsap.set(aside, { xPercent: drawerOpen ? 0 : -100, autoAlpha: 1 });
      return;
    }

    const overlayDur = reduce ? 0.12 : MOTION.overlay;
    const drawerDur = reduce ? 0.12 : MOTION.drawer;
    if (drawerOpen) {
      if (backdrop) gsap.to(backdrop, { autoAlpha: 1, duration: overlayDur, ease: MOTION.ease, overwrite: "auto" });
      gsap.to(aside, {
        xPercent: 0,
        autoAlpha: 1,
        duration: drawerDur,
        ease: MOTION.ease,
        overwrite: "auto",
      });
    } else {
      if (backdrop) gsap.to(backdrop, { autoAlpha: 0, duration: overlayDur, ease: MOTION.ease, overwrite: "auto" });
      gsap.to(aside, {
        xPercent: reduce ? 0 : -100,
        autoAlpha: reduce ? 0 : 1,
        duration: drawerDur,
        ease: MOTION.ease,
        overwrite: "auto",
      });
    }
  }, { dependencies: [drawerOpen] });

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      const aside = asideRef.current;
      const backdrop = backdropRef.current;
      if (!aside) return;
      if (mq.matches) {
        gsap.set(aside, { clearProps: "transform,x,xPercent,opacity,visibility" });
        if (backdrop) gsap.set(backdrop, { autoAlpha: 0 });
        return;
      }
      const reduce = prefersReducedMotion();
      if (drawerOpen) {
        if (backdrop) gsap.set(backdrop, { autoAlpha: 1 });
        gsap.set(aside, { xPercent: 0, autoAlpha: 1 });
      } else if (reduce) {
        if (backdrop) gsap.set(backdrop, { autoAlpha: 0 });
        gsap.set(aside, { autoAlpha: 0, xPercent: 0 });
      } else {
        if (backdrop) gsap.set(backdrop, { autoAlpha: 0 });
        gsap.set(aside, { xPercent: -100, autoAlpha: 1 });
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [drawerOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!session || pane !== "turns" || !visibleTurns.length) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const idx = Math.max(0, visibleTurns.findIndex((t) => t.id === selectedTurn));
        const next = visibleTurns[Math.min(visibleTurns.length - 1, idx + 1)];
        if (next) setSelectedTurn(next.id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const idx = Math.max(0, visibleTurns.findIndex((t) => t.id === selectedTurn));
        const prev = visibleTurns[Math.max(0, idx - 1)];
        if (prev) setSelectedTurn(prev.id);
      } else if (event.key === "Enter") {
        detailRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, pane, visibleTurns, selectedTurn]);

  return (
    <div ref={rootRef} className="relative flex h-dvh flex-col" data-drop-root>
      {dragging || busy ? <DropVeil busy={busy} /> : null}

      <header
        className="flex items-center gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--line)", background: "var(--bg-elev)" }}
      >
        <button
          type="button"
          className="press-scale inline-flex h-8 w-8 items-center justify-center rounded-md border md:hidden"
          style={{ borderColor: "var(--line)" }}
          onClick={() => setDrawerOpen(true)}
          aria-label="会话库"
        >
          <Menu size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="brand-mark text-[17px] leading-none">SessionLens</div>
          <div className="mt-0.5 truncate text-[11px]" style={{ color: "var(--muted)" }}>
            {session ? humanizeSessionText(session.title, 120) : "把 Claude Code / Codex 的 jsonl 拖到这里"}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".jsonl,application/jsonl,text/plain"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          className="press-scale inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px]"
          style={{ borderColor: "var(--line)", background: "var(--accent-dim)", color: "var(--accent)" }}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp size={14} />
          导入 jsonl
        </button>
        <ThemeToggle />
      </header>

      <div className="flex min-h-0 flex-1">
        <button
          ref={backdropRef}
          type="button"
          className={`fixed inset-0 z-10 opacity-0 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
          style={{ background: "color-mix(in srgb, var(--bg) 55%, transparent)" }}
          aria-label="关闭会话库"
          aria-hidden={!drawerOpen}
          tabIndex={drawerOpen ? 0 : -1}
          onClick={() => setDrawerOpen(false)}
        />
        <aside
          ref={asideRef}
          className={`library-aside scrollbar-thin w-[280px] shrink-0 overflow-auto border-r max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-[86vw] max-md:shadow-xl md:block ${drawerOpen ? "" : "max-md:pointer-events-none"}`}
          style={{ borderColor: "var(--line)", background: "var(--bg-elev)" }}
        >
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <div
              className="grid flex-1 grid-cols-2 rounded-md border p-0.5 text-[12px]"
              style={{ borderColor: "var(--line)" }}
              role="tablist"
              aria-label="会话库"
            >
              <button
                type="button"
                role="tab"
                aria-selected={libraryTab === "projects"}
                onClick={() => setLibraryTab("projects")}
                className="rounded px-2 py-1"
                style={{
                  background: libraryTab === "projects" ? "var(--accent-dim)" : "transparent",
                  color: libraryTab === "projects" ? "var(--accent)" : "var(--muted)",
                }}
              >
                项目
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={libraryTab === "imports"}
                onClick={() => setLibraryTab("imports")}
                className="rounded px-2 py-1"
                style={{
                  background: libraryTab === "imports" ? "var(--accent-dim)" : "transparent",
                  color: libraryTab === "imports" ? "var(--accent)" : "var(--muted)",
                }}
              >
                导入
              </button>
            </div>
            <button type="button" className="md:hidden" onClick={() => setDrawerOpen(false)} aria-label="关闭">
              <X size={14} />
            </button>
          </div>

          {libraryTab === "projects" ? (
            <div>
              <div className="flex items-center justify-between px-3 pb-2 text-[11px]" style={{ color: "var(--faint)" }}>
                <button
                  type="button"
                  disabled={busy || !canPickDirectory()}
                  className="inline-flex items-center gap-1"
                  style={{ color: canPickDirectory() ? "var(--accent)" : "var(--faint)" }}
                  onClick={() => void addProject()}
                >
                  <FolderPlus size={13} />
                  添加项目
                </button>
                {pendingProjectHint ? (
                  <button
                    type="button"
                    disabled={busy || !canPickDirectory()}
                    className="text-[11px]"
                    style={{ color: "var(--accent)" }}
                    onClick={() => void bindSessionHome()}
                  >
                    绑定 .claude / .codex
                  </button>
                ) : null}
              </div>
              {!canPickDirectory() ? (
                <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--muted)" }}>
                  当前浏览器不能选目录，请用上方「导入 jsonl」。
                </p>
              ) : null}
              {projects.length === 0 && canPickDirectory() ? (
                <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--muted)" }}>
                  添加项目目录，或直接选 ~/.claude / ~/.codex。会话不在仓库里，而在 ~/.claude/projects。
                </p>
              ) : null}
              {projects.map((project) => {
                const items = projectSessionMap.get(project.id) ?? [];
                const granted = projectAccess[project.id];
                if (granted !== false && items.length === 0) return null;
                return (
                  <div key={project.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <div className="min-w-0 truncate text-[11px]" style={{ color: "var(--faint)" }}>
                        {project.name}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-[11px]"
                        style={{ color: "var(--muted)" }}
                        onClick={() => void removeProject(project)}
                      >
                        移除
                      </button>
                    </div>
                    {granted === false ? (
                      <button
                        type="button"
                        className="px-3 pb-2 text-left text-[12px]"
                        style={{ color: "var(--accent)" }}
                        onClick={() => void authorizeProject(project)}
                      >
                        需要授权后才能读取这个目录
                      </button>
                    ) : (
                      <ul>
                        {items.map((item) => (
                          <LibrarySessionRow
                            key={item.id}
                            item={item}
                            selected={session?.id === item.id}
                            onOpen={() => {
                              setImportNote(null);
                              void openStored(item.id);
                            }}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-end px-3 pb-1 text-[11px]" style={{ color: "var(--faint)" }}>
                {importedSessions.length ? (
                  <button type="button" onClick={() => void removeAllImported()}>
                    清空
                  </button>
                ) : null}
              </div>
              {importedSessions.length === 0 ? (
                <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--muted)" }}>
                  还没有导入的会话。拖放或选择 jsonl 后会保存在这个浏览器里。
                </p>
              ) : (
                <ul>
                  {importedSessions.map((item) => (
                    <LibrarySessionRow
                      key={item.id}
                      item={item}
                      selected={session?.id === item.id}
                      onOpen={() => {
                        setImportNote(null);
                        void openStored(item.id);
                      }}
                      onDelete={() => void removeOne(item.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {busy ? (
            <div className="border-b px-4 py-2 text-[12px]" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              正在解析…
            </div>
          ) : null}
          {!busy && (importNote || warnings.length) ? (
            <div className="border-b px-4 py-2 text-[12px]" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              {[importNote, ...warnings].filter(Boolean).join(" · ")}
            </div>
          ) : null}
          {error ? (
            <div className="border-b px-4 py-2 text-[12px]" style={{ borderColor: "var(--line)", color: "var(--danger)" }}>
              {error}
            </div>
          ) : null}

          {!session ? (
            <EmptyState onPick={() => fileRef.current?.click()} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2" style={{ borderColor: "var(--line)" }}>
                <SourceBadge source={session.source} subagent={session.subagent} />
                <SummaryBar session={session} />
                <button
                  type="button"
                  className="ml-auto rounded-md px-2 py-1 text-[12px] md:hidden"
                  style={{ color: "var(--muted)" }}
                  onClick={() => setTimelineOpen((v) => !v)}
                >
                  {timelineOpen ? "收起时间轴" : "时间轴"}
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <section
                  className={`flex min-h-0 flex-col border-b md:w-[320px] md:shrink-0 md:border-b-0 md:border-r ${timelineOpen ? "max-md:h-[38vh]" : "max-md:hidden"}`}
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="shrink-0 border-b px-2 py-1.5" style={{ borderColor: "var(--line)" }}>
                    <div
                      className="grid grid-cols-2 rounded-md border p-0.5 text-[12px]"
                      style={{ borderColor: "var(--line)" }}
                      role="tablist"
                      aria-label="时间轴视图"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={pane === "turns"}
                        onClick={() => setPane("turns")}
                        className="rounded px-2 py-1"
                        style={{
                          background: pane === "turns" ? "var(--accent-dim)" : "transparent",
                          color: pane === "turns" ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        回合 {filterCounts.all}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={pane === "internals"}
                        onClick={() => setPane("internals")}
                        className="rounded px-2 py-1"
                        style={{
                          background: pane === "internals" ? "var(--accent-dim)" : "transparent",
                          color: pane === "internals" ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        内部事件 {session.internals.length}
                      </button>
                    </div>
                    {pane === "turns" ? (
                      <div className="mt-1 flex flex-wrap gap-0.5 text-[11px]">
                        {(["all", "user", "tools", "errors"] as const).map((key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setFilter(key)}
                            className="rounded-md px-1.5 py-0.5"
                            style={{
                              background: filter === key ? "var(--accent-dim)" : "transparent",
                              color: filter === key ? "var(--accent)" : "var(--muted)",
                            }}
                          >
                            {{ all: "全部", user: "用户", tools: "工具", errors: "失败" }[key]} {filterCounts[key]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-h-0 flex-1">
                    {pane === "internals" ? (
                      <InternalsList session={session} />
                    ) : (
                      <Timeline
                        turns={session.turns}
                        filter={filter}
                        selectedId={selected?.id}
                        onSelect={setSelectedTurn}
                      />
                    )}
                  </div>
                </section>
                <section
                  ref={detailRef}
                  tabIndex={-1}
                  className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
                >
                  {pane === "internals" ? (
                    <div className="flex h-full items-center justify-center p-8 text-[13px]" style={{ color: "var(--muted)" }}>
                      内部事件列在左侧。选「回合」继续读会话。
                    </div>
                  ) : (
                    <>
                      <div className="min-h-0 flex-1">
                        <DetailPane turn={selected} />
                      </div>
                      {session.tasks?.length ? (
                        <TaskPanel
                          key={session.id}
                          tasks={session.tasks}
                          selectedTurnId={selected?.id}
                          onSelectTurn={setSelectedTurn}
                        />
                      ) : null}
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function LibrarySessionRow({
  item,
  selected,
  onOpen,
  onDelete,
}: {
  item: StoredSession;
  selected: boolean;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className={`w-full px-3 py-2.5 text-left ${onDelete ? "pr-9" : "pr-3"}`}
        style={{
          background: selected ? "var(--accent-dim)" : "transparent",
        }}
      >
        <div className="truncate text-[13px] font-medium">{humanizeSessionText(item.title, 72)}</div>
        <div className="mt-1 flex items-center gap-2">
          <SourceBadge source={item.source} subagent={item.subagent} />
          <span className="truncate text-[11px]" style={{ color: "var(--faint)" }}>
            {cwdShortName(item.cwd)}
          </span>
        </div>
      </button>
      {onDelete ? (
        <button
          type="button"
          className="absolute right-2 top-2 hidden rounded p-1 group-hover:block group-focus-within:block"
          style={{ color: "var(--muted)" }}
          aria-label="删除"
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </li>
  );
}

function InternalsList({ session }: { session: Session }) {
  if (!session.internals.length) {
    return (
      <div className="p-6 text-[13px]" style={{ color: "var(--muted)" }}>
        没有内部事件。
      </div>
    );
  }
  return (
    <ul className="scrollbar-thin h-full overflow-auto text-[12px]">
      {session.internals.map((item) => (
        <li key={item.id} className="border-b px-3 py-2" style={{ borderColor: "var(--line)" }}>
          <div style={{ fontFamily: "var(--font-mono), var(--mono)", color: "var(--accent)" }}>{item.type}</div>
          <div className="truncate" style={{ color: "var(--muted)" }}>
            {item.summary}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DropVeil({ busy }: { busy: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const card = root.querySelector("[data-drop-card]");
      const reduce = prefersReducedMotion();
      const duration = reduce ? 0.12 : MOTION.veil;
      gsap.fromTo(root, { autoAlpha: 0 }, { autoAlpha: 1, duration, ease: MOTION.ease });
      if (card) {
        gsap.fromTo(
          card,
          { y: reduce ? 0 : 10, opacity: 0, scale: reduce ? 1 : 0.97 },
          { y: 0, opacity: 1, scale: 1, duration, ease: MOTION.ease },
        );
      }
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      className="drop-veil pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--bg) 72%, transparent)" }}
    >
      <div
        data-drop-card
        className="rounded-xl border px-8 py-6 text-center"
        style={{ borderColor: "var(--accent)", background: "var(--bg-elev)", color: "var(--text)" }}
      >
        <div className="brand-mark text-[22px]">{busy ? "正在解析…" : "松开以导入 jsonl"}</div>
        {!busy ? (
          <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
            支持一次多个文件
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const items = root.querySelectorAll("[data-empty-item]");
      const reduce = prefersReducedMotion();
      gsap.from(items, {
        opacity: 0,
        y: reduce ? 0 : 8,
        duration: reduce ? 0.12 : MOTION.empty,
        stagger: reduce ? 0 : 0.04,
        ease: MOTION.ease,
      });
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="flex flex-1 items-center justify-center p-6">
      <button
        type="button"
        onClick={onPick}
        className="empty-invite press-scale w-full max-w-sm px-3 py-5 text-center"
      >
        <div data-empty-item className="mx-auto w-[min(100%,240px)]" aria-hidden="true">
          <EmptyLogTape />
        </div>
        <div data-empty-item>
          <div className="empty-invite-title mt-5">
            把 <span className="empty-invite-ext">jsonl</span> 拖到这里
          </div>
          <p className="empty-invite-body mt-2">
            <span className="empty-invite-act">点这里选择文件。</span>
            解析只在这台浏览器里完成，不会上传。
          </p>
        </div>
        <div data-empty-item className="mt-5">
          <p className="empty-invite-paths">
            <span>Claude Code</span>
            <span>~/.claude/projects/…/*.jsonl</span>
            <span>Codex</span>
            <span>会话目录里的 *.jsonl</span>
          </p>
          <p className="empty-invite-meta mt-1.5">
            可一次选多个文件 · 超过 50MB 会警告 · 超过 150MB 会拒绝
          </p>
        </div>
      </button>
    </div>
  );
}

function EmptyLogTape() {
  return (
    <svg viewBox="0 0 280 132" fill="none" className="empty-tape">
      <defs>
        <radialGradient id="empty-glow" cx="50%" cy="48%" r="58%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="65%" stopColor="var(--accent)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="empty-lens-glow" cx="140" cy="66" rx="124" ry="62" fill="url(#empty-glow)" />
      {[18, 36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 252].map((x) => (
        <g key={x}>
          <circle cx={x} cy="22" r="2.6" fill="var(--faint)" opacity="0.55" />
          <circle cx={x} cy="110" r="2.6" fill="var(--faint)" opacity="0.55" />
        </g>
      ))}
      <rect x="36" y="42" width="168" height="10" rx="2" fill="var(--claude)" opacity="0.7" />
      <rect x="36" y="61" width="124" height="10" rx="2" fill="var(--accent)" />
      <rect x="36" y="80" width="148" height="10" rx="2" fill="var(--codex)" opacity="0.72" />
      <g className="empty-read-head" transform="translate(168 40)">
        <circle cx="22" cy="26" r="30" fill="none" stroke="var(--accent)" strokeOpacity="0.28" strokeWidth="1.5" />
        <circle cx="22" cy="26" r="18" fill="color-mix(in srgb, var(--bg) 55%, transparent)" stroke="var(--accent)" strokeOpacity="0.8" strokeWidth="1.5" />
        <circle className="empty-tape-pip" cx="22" cy="26" r="5" fill="var(--accent)" />
      </g>
    </svg>
  );
}
