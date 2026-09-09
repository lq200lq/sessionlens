"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Menu, Trash2, X } from "lucide-react";
import { initialTurnId, importSummary } from "@/lib/display";
import { ingestSessionLog } from "@/lib/ingest";
import type { Session } from "@/lib/ingest/types";
import { cwdShortName, humanizeSessionText } from "@/lib/ingest/util";
import {
  clearStoredSessions,
  deleteStoredSession,
  findByHash,
  getStoredSession,
  listStoredSessions,
  putStoredSession,
  sha256Hex,
  touchStoredSession,
  type StoredSession,
} from "@/lib/storage";
import { MOTION, gsap, prefersReducedMotion, useGSAP } from "@/lib/motion";
import { SourceBadge } from "./SourceBadge";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline, matchesFilter, type Filter } from "./Timeline";
import { DetailPane, SummaryBar } from "./DetailPane";

function setQueryId(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("s", id);
  else url.searchParams.delete("s");
  window.history.replaceState(null, "", url.toString());
}

type Pane = "turns" | "internals";

export function SessionApp() {
  const [library, setLibrary] = useState<StoredSession[]>([]);
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

  useEffect(() => {
    void (async () => {
      await reloadLibrary();
      const id = new URLSearchParams(window.location.search).get("s");
      if (id) await openStored(id);
    })();
  }, [openStored, reloadLibrary]);

  const importFiles = async (fileList: FileList | File[]) => {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    const successes: { id: string; session: Session }[] = [];
    try {
      for (const file of files) {
        const text = await file.text();
        const result = ingestSessionLog({
          filename: file.name,
          text,
          byteLength: file.size,
        });
        if (!result.ok) {
          failures.push(`${file.name}：${result.error}`);
          continue;
        }
        const hash = await sha256Hex(text);
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
          lastOpenedAt: now,
          filename: file.name,
          contentHash: hash,
          jsonl: text,
          subagent: result.session.subagent,
        });
        result.session.id = id;
        successes.push({ id, session: result.session });
      }
      await reloadLibrary();
      if (successes.length) {
        const last = successes.at(-1)!;
        await openStored(last.id, last.session);
        setImportNote(importSummary(last.session.turns));
      }
      setWarnings(successes.flatMap((s) => s.session.warnings));
      if (!successes.length && failures.length) setError(failures.join("\n"));
      else if (failures.length) setError(failures.join("\n"));
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

  const removeAll = async () => {
    if (!confirm("清空本地全部会话？此操作无法撤销。")) return;
    await clearStoredSessions();
    setSession(null);
    setQueryId(null);
    setImportNote(null);
    await reloadLibrary();
  };

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
          aria-label="最近会话"
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
          aria-label="关闭最近会话"
          aria-hidden={!drawerOpen}
          tabIndex={drawerOpen ? 0 : -1}
          onClick={() => setDrawerOpen(false)}
        />
        <aside
          ref={asideRef}
          className={`library-aside scrollbar-thin w-[280px] shrink-0 overflow-auto border-r max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-[86vw] max-md:shadow-xl md:block ${drawerOpen ? "" : "max-md:pointer-events-none"}`}
          style={{ borderColor: "var(--line)", background: "var(--bg-elev)" }}
        >
          <div className="flex items-center justify-between px-3 py-2 text-[11px]" style={{ color: "var(--faint)" }}>
            <span>最近会话</span>
            <span className="flex items-center gap-2">
              {library.length ? (
                <button type="button" onClick={() => void removeAll()}>
                  清空
                </button>
              ) : null}
              <button type="button" className="md:hidden" onClick={() => setDrawerOpen(false)} aria-label="关闭">
                <X size={14} />
              </button>
            </span>
          </div>
          {library.length === 0 ? (
            <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--muted)" }}>
              还没有本地会话。导入 jsonl 后会保存在这个浏览器里。
            </p>
          ) : (
            <ul>
              {library.map((item) => (
                <li key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      setImportNote(null);
                      void openStored(item.id);
                    }}
                    className="w-full px-3 py-2.5 pr-9 text-left"
                    style={{
                      background: session?.id === item.id ? "var(--accent-dim)" : "transparent",
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
                  <button
                    type="button"
                    className="absolute right-2 top-2 hidden rounded p-1 group-hover:block group-focus-within:block"
                    style={{ color: "var(--muted)" }}
                    aria-label="删除"
                    onClick={() => void removeOne(item.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--line)" }}>
                <SourceBadge source={session.source} subagent={session.subagent} />
                <div className="flex flex-wrap items-center gap-1 text-[12px]">
                  <div
                    className="inline-flex rounded-md border p-0.5"
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
                  {pane === "turns"
                    ? (["all", "user", "tools", "errors"] as const).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFilter(key)}
                          className="rounded-md px-2 py-1"
                          style={{
                            background: filter === key ? "var(--accent-dim)" : "transparent",
                            color: filter === key ? "var(--accent)" : "var(--muted)",
                          }}
                        >
                          {{ all: "全部", user: "用户", tools: "工具", errors: "失败" }[key]} {filterCounts[key]}
                        </button>
                      ))
                    : null}
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 md:hidden"
                    style={{ color: "var(--muted)" }}
                    onClick={() => setTimelineOpen((v) => !v)}
                  >
                    {timelineOpen ? "收起时间轴" : "时间轴"}
                  </button>
                </div>
              </div>
              <SummaryBar session={session} />
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <section
                  className={`border-b md:w-[320px] md:shrink-0 md:border-b-0 md:border-r ${timelineOpen ? "max-md:h-[38vh]" : "max-md:hidden"}`}
                  style={{ borderColor: "var(--line)" }}
                >
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
                </section>
                <section
                  ref={detailRef}
                  tabIndex={-1}
                  className="min-h-0 min-w-0 flex-1 outline-none"
                >
                  {pane === "internals" ? (
                    <div className="flex h-full items-center justify-center p-8 text-[13px]" style={{ color: "var(--muted)" }}>
                      内部事件列在左侧。选「回合」继续读会话。
                    </div>
                  ) : (
                    <DetailPane turn={selected} />
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
        className="press-scale w-full max-w-xl rounded-xl border px-8 py-14 text-center"
        style={{ borderColor: "var(--line)", background: "var(--bg-elev)" }}
      >
        <div data-empty-item className="brand-mark text-[22px]">
          拖放 jsonl 到此处
        </div>
        <p data-empty-item className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
          解析只在这台浏览器里完成，文件不会上传。
        </p>
        <p
          data-empty-item
          className="mt-5 text-left text-[11px] leading-5"
          style={{ color: "var(--faint)", fontFamily: "var(--font-mono), var(--mono)" }}
        >
          Claude Code　~/.claude/projects/…/*.jsonl
          <br />
          Codex　　　会话目录里的 *.jsonl
        </p>
        <p data-empty-item className="mt-4 text-[12px]" style={{ color: "var(--faint)" }}>
          可一次选择多个文件 · 超过 50MB 会警告 · 超过 150MB 会拒绝
        </p>
      </button>
    </div>
  );
}
