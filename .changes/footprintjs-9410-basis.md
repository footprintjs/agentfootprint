---
type: added
---
**Every trace answer the context ledger and context-bisect read now says why it is not exact, when it is not.**
footprintjs 9.33.0 added basis twins of its two key readers — `commitValueAtWithBasis` and
`findLastWriterWithBasis` on `footprintjs/trace` — so an answer that rests on rows inside a key
(a subflow's input seed, an outputMapper merge-back), on the state before the run, on a
redaction or on a delete carries a reason code (`'nested-rows'`, `'from-initial-state'`,
`'redacted'`, `'deleted'`, `'never-written'`; each one's sentence is `HONESTY_CODES[code]`).
agentfootprint's readers now go through them, and the codes ride the answers they already
returned, as new optional fields that are ABSENT when the answer is exact (an all-exact run
keeps its bytes):

- `contextLedger().recordRun(...)` → `RecordedRun.basis?: Record<stateKey, ValueBasis[]>` —
  e.g. `{ history: ['redacted'] }` for a run whose `history` was redacted (the placeholder is no
  longer counted as if it were data without a word).
- `assembleTrajectory(...)` → `ContextSource.basis?` and `ProximateToolSource.basis?` (the
  writer's codes, then the value's) — a context source with no writer before its `call-llm`
  now says `['never-written']`.
- `localizeContextBug(...)` → `SuspectDetail.valueBasis?` on the default classifier's suspects,
  read through the new `ClassifyContext.basisOf(key)` (see Changed).

Pinned: `activeByslot` — written by the injection-engine subflow's merge-back only through rows
inside the key — answers its MOUNT (`sf-injection-engine#k`) as the writer with
`['nested-rows']`, and its value with `['nested-rows', 'from-initial-state']` (before
footprintjs 9.33.0 every key query called it never written); a grouped (`dynamic-grouped`)
loop's inner log answers `lastToolResult` from the subflow's input seed, named by its mount,
with `['nested-rows']` — the copy-in, not the producing tool-calls stage, so grouped frames
still carry no proximate tool edge.
