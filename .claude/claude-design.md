# Claude Design — tether-app config

Read by the `applying-claude-design` skill when fetching a Claude Design
handoff and computing the gap report against this codebase.

## target_dir

`tether-app/src/`

## token_target

`tether-app/src/styles/tokens.css` — plain CSS custom properties; light-first
with `[data-theme="dark"]` override block. The token surface is normative for
the project — design components must consume `var(--*)` rather than hard-coded
hex / sizes / radii.

## freeze_rules

These spec decisions take priority over anything a future handoff might
contradict. Any handoff that violates a freeze should be flagged BLOCK in the
gap report and surfaced to the user — DO NOT auto-fix.

- **§11.Y / D-19** — desktop = three-column layout (workspace tree | skill
  artifact | chat); mobile = chat-first single column with workspace drawer
  and skill push.
- **§11.AA / phase1-dag-protocol §3** — fenced block taxonomy is exactly four
  types: `dag` / `form` / `candidates` / `media`. Each renders in two layouts:
  `compact` (inline in chat / mobile card) and `full` (expanded artifact pane
  / mobile push route). New block types require a spec change first.
- **D-5** — daemon transparent contract: the daemon never peers inside a
  block's content. Block parsing / rendering is App-side only. Do not
  introduce designs that require server-side block awareness.
- **D-20 / §11.Z** — skill = cc plugin + `tether.toml` overlay. UI must list
  skills from `tether skill list`; do not bake skill metadata into the App.
- **§11.J / D-16** — pairing flow = QR (primary) + 6-character SAS code
  fallback. Server-mediated pairing is dev-only, off the production path.
- **Settings 4-area shape** — account / skills / connection / about. New
  top-level settings tabs require a spec change first.
- **Theme** — light-first; dark variant must use the same token names with
  `[data-theme="dark"]` overrides (no parallel dark-only token file).

## component_mapping

Greenfield as of 2026-05-06 — no existing components to remap. Until a
shared primitives library lands (likely Phase 4 — fenced blocks first, since
those have the cleanest contract), handoff JSX components translate to React
components under `src/` directly. Update this section as primitives stabilize.

## staged-application plan

Sourced from gap report on bundle `design-handoff-2026-05-06`. Each phase is
its own polyforge Task / GitHub PR.

| Phase | Scope | Status |
|---|---|---|
| 1 | Vite React scaffold + tokens (this file) | 🟡 in flight |
| 2 | Store + actions abstraction (mock data) | ⬜ |
| 3 | 4 fenced blocks (compact + full) | ⬜ |
| 4 | Desktop three-column layout | ⬜ |
| 5 | Mobile chat-first + drawer + skill push | ⬜ |
| 6 | Pair flow (desktop initiator + mobile companion) | ⬜ |
| 7 | Settings (4 tabs) + Errors + Tweaks | ⬜ |
| 8 | Animation pass + virtualization for tree | ⬜ |

## handoff archive

Original bundle preserved at:
`.workspace/memory/local/design-handoff-2026-05-06/` (extracted)
`.workspace/memory/local/design-handoff-2026-05-06.tar.gz` (raw)

Claude Design URLs are short-lived; the bundle MUST be read from the local
archive in future sessions.

## stack

- React 18.3 + TypeScript 5.6
- Vite 5.4 (with `@vitejs/plugin-react`)
- Tauri 2.11 (desktop + Android)
- Plain CSS custom properties (no Tailwind / CSS-in-JS yet — re-evaluate at
  Phase 4 if component count drives a system)
