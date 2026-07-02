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

## Persistence

`exportJSON()` / `importJSON()` — plain JSON, counts merge additively.
The consumer owns storage (a file, Redis, a MemoryStore — your call).

## Evolution (L2/L3 — built on these rows)

- **Tool gate**: a `ToolGatePredicate` for `gatedTools(inner, predicate)` —
  demote tools below an earnRate floor after N offers.
- **Skill gate**: an `EntryScorer` for `skillGraph().entryBy(...)` —
  ledger-weighted entry ranking.
- **Injection gate**: `ledgerGated(injection, policy)` — demote an `always`
  injection to a ledger-backed rule trigger. `always` pieces are exempt
  unless explicitly wrapped.
- Default policy: **demote, never drop** — a demoted piece still enters when
  nothing better competes, so it keeps generating fresh ledger data.
- Measurement: tokens-per-turn, gated vs not, printed side by side.
