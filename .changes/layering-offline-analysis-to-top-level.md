---
type: internal
---
**The run-analysis libraries left `src/lib/` for top-level folders.** `context-bisect/` (the contextual-bug localizer and its strategy arms), `context-ledger/` (which context pieces earned their tokens), `bug-report/` (a run packaged for a person to file) and `recorded-chat/` (a chat session that can explain itself) moved from `src/lib/` to `src/`, with their tests from `test/lib/` to `test/`. Each folder keeps its layer in the layer table, so `npm run check:layering` reports the same edges; `src/lib/` now holds fewer feature packages beside its leaves. Internal paths only: every public door exports the same names.
