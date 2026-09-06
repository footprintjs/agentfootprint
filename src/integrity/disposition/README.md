**Fold** — the accounting that keeps the family honest: every registered check
files one disposition per encounter, so "no check ran" is a different observable
state from "nothing was wrong".

## What it reads / what it writes
- Owns: the per-check disposition rows. `report()` hands out FRESH POJO rows
  (`ledger.ts` · `DispositionLedger`, "The T9 theorems, both") — detached, safe for events, snapshots and recordings.
- Read by `src/core/Agent.ts` · `agentfootprint.integrity.disposition`, which files them as ONE
  `agentfootprint.integrity.disposition` event; every later reader (including
  the trace toolpack's model-facing partial-coverage line) reads that EVENT,
  never this accumulator.

## The one law here
Silence is not a verdict. `assertAlive()` fails a run whose registered check
filed nothing at all, because an unrun check and a clean run must never read the
same.

## Files
- `ledger.ts` — the accumulator behind a read-only report.
- `lifecycle.ts` — registration and the dev canary.
- `types.ts` — what happened when a check MET an assertion, as data.
