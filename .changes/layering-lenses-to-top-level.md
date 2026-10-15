---
type: internal
---
**`time-travel`, `trace-toolpack` and `answer-account` move out of `src/lib/` to top-level folders.** Each keeps its layer in the table (L10, the lenses over a run). The files moved with `git mv` and only import paths changed. Every public door exports the same names. The self-explain host's `sideEffects` entry now reads `**/trace-toolpack/selfExplainHost.js`, and it still flags the same built file, so `.selfExplain()` still registers wherever the root door or `/observe` is imported.
