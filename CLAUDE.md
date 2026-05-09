# tether-app — entire repo deprecated by v2 pivot

## v0/ is archived — do not read proactively

整个 tether-app 仓的 v1 代码已 `git mv` 到 `v0/`：Tauri desktop + mobile shell（`src/`、`src-tauri/`）、Vite 配置、Android build 脚本、package.json 等。

- **不要主动读** `v0/`。tether-app 在 v2 pivot 之后**没有新工作**——v2 的前端通过 tether repo 里的 `web/` + Go embed.FS + 浏览器（HTTP/3 / WebTransport）交付，**不再需要 native shell**。
- 仅当 v2 实施明确要参考某个 v1 UX 行为（例如 `v0/src/components/MobileMain.tsx` 的移动端 layout），按需读单个文件。
- v0/ 不再修改、不再扩展、不再修 bug。Mobile 形态从 Tauri APK / iOS 切到 PWA（"Chrome 添加到主屏幕"），不在这个仓做。

## v2 pivot 后这个仓还会动吗

理论上**不会**。v2 v0.1 ship 后，tether-app 仓可以挂 archive 标志或 README 改成"deprecated, see github.com/piaobeizu/tether"。当前（2026-05-09）保留它的活跃工作树是因为 v2 还没 ship；ship 之后归档整仓。

## Authoritative spec / plan

- **Spec**: `../tether-doc/wiki/specs/2026-05-09-tether-simplified-design.md` §10.A–§10.K
- **Plan**: `.workspace/memory/local/plan-t-01KR6E5V5PG3CXS598FABDY5WZ.md`
- **Active task**: `t-01KR6E5V5PG3CXS598FABDY5WZ` slug `v2-impl`（不涉及 tether-app）

## What's at root

| Path | Status | Why |
|---|---|---|
| `.claude/` | keep | Claude Code config |
| `.gitignore` | keep | 沿用 |
| `v0/` | **archived** | 整仓 v1 代码 |

## Commits

走 `/pf2-commit msg="..."`，不要裸 `git commit`。
