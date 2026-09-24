**Lens** — the served view of a COMPLETED run's record, composed for a model:
bounded by default, honest about what it cannot see, redaction-respecting.

## What it reads / what it writes
- Reads the finished run through footprintjs's own owners — `causalChain`,
  `commitValueAt`, `findLastWriter`, `sliceForKey`, `arrayProvenance`,
  `elementProvenance` — and re-derives none of them. Partial-coverage lines read
  the recorded disposition EVENT (owner: `src/integrity/disposition/ledger.ts`),
  never a live ledger.
- Writes tool results into the model's history. Every value it serves passes
  through `bounded.ts`.

## The one law here
It never re-runs anything and never reconstructs around a redaction. Where the
record is bounded or missing, the answer says so rather than filling the gap —
an attention omission that must stay visible.

## An id a provider reused: the latest call decides
A provider may reuse a tool-call id across turns (the library's own fallback
ids are minted per provider instance). `inspect_tool_call` answers for the
LATEST call under the id: its result is the latest `role: 'tool'` message, its
outcome and duration come off the LAST `tool_end` for the id
(`traceToolpack.ts` · `buildInspectToolCall`), and it reads "not dispatched"
when the latest bracket or message carries the batch settlement's marker
(9.113.0, `notDispatchedOf`). The step line still names the step of the first
call under the id that ran (`bracketsFor`).

```text
c1 answered 'first answer' in 1ms, then — reused — threw 'second call failed' after 27ms:
  result: "second call failed"
  outcome: error — the tool threw or returned a failure
  duration: 27ms
```

## Files
- `traceToolpack.ts` — the eleven trace tools.
- `bounded.ts` — the one bound every served value passes through.
- `selfExplain.ts`, `traceDebugAgent.ts` — the two conversational doors.
- `traceToolNames.ts` — the two facts `.selfExplain()` needs BEFORE the pack
  loads (the names it reserves, the "no run yet" answer). The pack itself is
  reached through `import()` on the first iteration the skill is active
  (`selfExplain.ts` · `lazilyMountedTraceTools`), so an agent that never
  enables it never ships it; `/observe` and `/debug` carry it eagerly, on
  purpose. Fenced at the bundle graph by
  `test/lib/trace-toolpack/browserGraph.test.ts`.
- `debugPrompt.ts` — the methodology text both doors share, so they cannot drift.
- `openRecording.ts`, `lazyToolpack.ts`, `innerRunRecords.ts`, `types.ts`,
  `index.ts`.
