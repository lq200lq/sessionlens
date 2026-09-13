# SessionLens

A browser-only viewer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://github.com/openai/codex) session logs. Drop in a `.jsonl` file, read the turns, tools, and failures in a two-pane timeline — logs stay in IndexedDB and never leave your machine.

**Demo:** [https://sessionlens-gamma.vercel.app](https://sessionlens-gamma.vercel.app)

## Use

1. Open the demo (or run locally) and drop one or more `.jsonl` files onto the page.
2. Typical locations on disk (SessionLens does not scan your filesystem; you pick the files):
   - **Claude Code:** `~/.claude/projects/<encoded-cwd>/<sessionUuid>.jsonl`
   - **Codex:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
3. `~/.claude/history.jsonl` is input history, not a session, and will be rejected.

Sessions persist locally so you can close the tab and come back. There is no login, no API key, and no sample transcript bundled in the app.

Files over ~50MB warn before parse; files over ~150MB are refused so the tab is not blown out of memory.

## Develop

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run typecheck
npm run build
```

## License

[MIT](LICENSE)

---

# SessionLens（中文）

纯浏览器里复盘 Claude Code 与 Codex 的会话 `.jsonl`。拖进文件后用左时间轴 + 右详情阅读回合、工具调用和失败；原文只存在本机 IndexedDB，不会上传。

**演示：** [https://sessionlens-gamma.vercel.app](https://sessionlens-gamma.vercel.app)

## 用法

1. 打开演示页（或本地运行），把一场或多场 `.jsonl` 拖进页面。
2. 常见本机路径（产品不扫盘，需要你自己选文件）：
   - **Claude Code：** `~/.claude/projects/<把绝对路径里的 / 换成 - 的目录>/<sessionUuid>.jsonl`
   - **Codex：** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
3. `~/.claude/history.jsonl` 不是会话，导入会失败。

刷新后最近会话仍在。无需登录、不必配置 API，也不内置示例会话。

大约超过 50MB 会先警告仍可尝试；超过约 150MB 会拒绝打开。

## 本地开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

```bash
npm test
npm run typecheck
npm run build
```

## 许可证

[MIT](LICENSE)
