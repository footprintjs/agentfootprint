---
type: internal
---
**`influence-core`, `tool-lint` and `trust-boundaries` move out of `src/lib/` to top-level folders.** Each keeps its layer in the table (`npm run check:layering`), so `src/lib/` moves closer to holding only leaves. The files moved with `git mv` and only import paths changed. Every public door exports the same names, and the `agentfootprint-lint-tools` bin now loads `dist/esm/tool-lint/cli.js`.
