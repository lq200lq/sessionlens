# SessionLens

[English](README.md) | [中文](README.zh-CN.md)

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
