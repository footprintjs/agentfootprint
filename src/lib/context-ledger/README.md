# context-ledger — which context pieces earned their tokens?

Context engineering fails in one predictable direction: **"include everything
to be safe."** Every injection, skill and tool schema costs tokens every turn,
whether or not it ever mattered. The ledger keeps score across runs, and its
rows feed the gates that make future turns leaner — the mechanism that makes
lesser models viable.

```ts
import { contextLedger } from 'agentfootprint/observe';

const ledger = contextLedger();
await agent.run({ message: '…' });
ledger.recordRun(agent);                  // post-run: reads the commit log
ledger.recordOutcome('good');             // thumbs / eval bucket / triage verdict

ledger.rows();                            // worst earnRate first
// { id: 'legacy-faq', kind: 'injection', offered: 42, used: 0,
//   approxTokensSpent: 18000, earnRate: 0, outcomes: { good: 12, bad: 3 } }
```

## What counts (all structural facts from the commit log)

| Column | Source |
|---|---|
| `offered` + `approxTokensSpent` | every commit of `activeInjections` / `dynamicToolSchemas` — one offer per piece per iteration (folded with `commitValueAt`, exact under the agent's delta default) |
| `used` — per-kind, explicit | **tool** → an assistant message actually called it (`'tool-called'`) · **skill** → `activatedInjectionIds` (`'skill-activated'`) · **injection** → its slot's write sits on the final answer's backward slice (`'answer-slice(slot)'`) |
| `outcomes` | consumer labels per run (`recordOutcome`), credited to every piece OFFERED in that run |
| `earnRate` | `used ÷ offered` — THE headline number |

The slot→slice join needs no id conventions: for each slot key,
`findLastWriter` names the commit that fed the final LLM call; membership of
that writer in the answer's `sliceForKey` DAG is the signal.

## Honesty model

- Every counter is a recorded fact — offers are commits, uses are calls/
  activations/slice membership. Nothing inferred from model internals.
- `usedVia` rides every row: you always see WHY something counted.
- Slice credit is **slot-granular** (all injections sharing a slot share its
  write) — the signal name says so.
- `approxTokens*` = serialized length ÷ 4. An estimate, named as one.
- **No causal claims.** `earnRate` is bookkeeping; outcome columns are
  presence-correlation. Ablation (`localizeContextBug` / context-bisect) can
  upgrade individual rows to causal verdicts when you pay for the reruns.

## Which runs it can meter

- `recordRun` returns the `RecordedRun` when it found at least one LLM-call
  marker, and `undefined` when it found none — **an unmeterable run is
  refused, never silently mis-scored.** `LLMCall` (single call, no agent
  loop) is the common `undefined` case: it never commits the context keys
  the ledger reads.
- Grouped agents (`reactMode: 'dynamic-grouped'`) ARE supported: the per-
  iteration context commits live inside each `sf-llm-call` subflow's own
  log, and the ledger folds offers from those inner logs. One known gap:
  `'answer-slice(slot)'` credit needs the slot writes in the ROOT commit
  log, so in grouped mode injections earn via `'skill-activated'` only —
  the row's `usedVia` shows exactly which signals fired, so nothing is
  overstated.

## Persistence

`exportJSON()` / `importJSON()` — plain JSON, counts merge additively.
The consumer owns storage (a file, Redis, a MemoryStore — your call).

## The gates (L2 — built on these rows, see `gates.ts`)

- **Tool gate**: `ledgerToolGate(ledger, policy?)` — a `ToolGatePredicate`
  for `gatedTools(inner, predicate)`. Unused tool schemas are usually the
  biggest silent token cost; start here.
- **Skill gate**: `ledgerEntryScorer(ledger, inner, policy?)` — wraps any
  `EntryScorer` for `skillGraph().entryBy(...)`; demotion is ranking
  pressure (score × 0.25 re-ranked through `rankEntries`, so the pick and
  the surfaced relevance always agree), never exclusion.
- **Injection gate**: `ledgerGated(injection, ledger, policy?)` — rewrites
  an `always` trigger to a ledger-backed rule, ANDs an existing rule, and
  passes demand-driven triggers through untouched. `always` pieces are
  exempt unless explicitly wrapped.
- Policy (`LedgerPolicy`): **demote, never starve** — below `minOffers`
  (5) everything passes; at/above `earnRateFloor` (0.05) it earns its way
  in; a demoted piece gets parole every `refreshEvery`-th (10) decision so
  it keeps generating fresh ledger data.
- Measurement (L3): tokens-per-turn gated vs not, side by side — see
  `examples/features/32-context-ledger.ts` (88% less on the over-stuffed
  fixture).
