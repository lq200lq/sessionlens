# SessionLens

[English](README.md) | [中文](README.zh-CN.md)

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
