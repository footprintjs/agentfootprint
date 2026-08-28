# runbook — procedures as tools, answers as evidence

`runbookAsTool` wraps a footprintjs chart as one Agent tool whose every
answer carries the **mandatory honesty spine**: the coverage ledger (inner
tools' ledgers folded upward), provenance re-emitted first, the rule set's
name + version, and the recorded walk as an artifact ticket
(`recording/chart-walk`). An optional verdict/rowset projection is selected
by `resultKind: 'verdict/*'`.

One file per job:

- `types.ts` — the options bag and the envelope (spine + projection).
- `runbookAsTool.ts` — the bridge: fresh executor per call, narrative
  recorder, envelope assembly, absence pass-through, kept records.
- `dispatch.ts` — the wrapper over `ctx.tools`: records every inner outcome
  for the coverage fold; an inner absence short-circuits unless the call
  site declared `{ allowAbsent: true }`.
- `coverage.ts` — the three-source ledger fold (inner ledgers, the chart's
  `coverage` state key, the bridge's own entries) + the sentence.
- `walk.ts` — the projection law (control flow survives the cap), truthful
  counters, the guarded mint (a failed mint costs the ticket, never the
  answer).
- `verdicts.ts` — the rowset off the `verdicts` state key, the one-cap
  table, and meanings GENERATED from declared branches + observed rule
  labels.

Reserved state keys the bridge reads: `verdicts`, `coverage`, `report`.
Reserved verdict word: `declined` (counted into the ledger as not-checked).

Phase boundaries (honest): pause is not yet bridged (a paused chart throws
with the checkpoint attached — `walk_segment` ships now so the wire will not
break when resumed segments arrive); inner dispatch refuses `checkIn` /
`wants` tools by name and resolves `needs` on the non-interactive path only.
