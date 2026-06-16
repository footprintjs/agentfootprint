# Two-score localization — a context bug costs you *quality* or *cost*

> `assignCostVerdicts` · `classifySuspect` · `RunCost` · `CostVerdict` · `SuspectClass`
> — from `agentfootprint/observe`. Extends `localizeContextBug` (proposal 004).

## The problem it solves

`localizeContextBug` answers one question: *did this context piece make the answer
wrong?* (quality). But a context bug has a **second cost**: a misdirecting piece can
make the agent take a wrong tool-call early and **waste loops/tokens** — *even when the
model recovers and answers correctly*. That cost is invisible to answer-only metrics. We
score it **separately** (one number per concern — Convention 1), from the **same** ablation.

## One ablation, two readouts

The ablation tier already removes a suspect and re-runs the agent to see if the **answer
flips**. If your runner returns **`{ output, cost }`** instead of a bare string, the same
re-runs also report the run's cost — no extra runs:

```typescript
// quality-only (unchanged): runner returns a string
const runner = async (specs, { seed }) => rerunAgent(specs, seed);          // => string

// unlock the cost score: also report the run's loops/tokens
const runner = async (specs, { seed }) => {
  const { output, loops, tokens } = await rerunAgent(specs, seed);
  return { output, cost: { loops, tokens } };                               // => { output, cost }
};
```

`localizeContextBug` then attaches a `cost` verdict to each suspect automatically.

## The two scores per suspect

| field | meaning |
|---|---|
| `verdict` (quality) | the existing flip verdict — *removing it changed the answer* (the strong **causal** tier) |
| `cost.reducedCostOnRemoval` | *removing it reduced loops/tokens, beyond a placebo, stably* (a **weaker, gated** tier) |
| `cost.loopsSaved` / `tokensSaved` | baseline median − suspect median |
| `cost.stable` | sign consistent across seeds AND a placebo band existed |

`classifySuspect(suspect)` derives the 2×2:

| | cost reduced (stable) | no cost effect |
|---|---|---|
| **answer flips** | `both` | `content-bug` |
| **answer unchanged** | `cost-cause` — the **silent decision bug** | `no-detected-effect` |

```typescript
import { classifySuspect } from 'agentfootprint/observe';
for (const s of report.suspects) console.log(s.source, classifySuspect(s));
```

## How the cost score stays honest

The cost score is **not** as strong as the flip, and the library treats it that way:

- **Placebo control.** A cost cause must reduce loops by **more than** the reduction seen
  when removing pieces that *don't* change the answer (benign path variance), computed
  leave-one-out. *(v1 limitation: the placebo population is the non-flipping suspects, so the
  band is conservative and under-detects when several pieces reduce cost similarly — the safe
  direction. A dedicated neutral-filler placebo is v2.)*
- **Stability.** A `+1` loop is brittle; *determinism ≠ robustness*. A piece is a cost cause
  only if **no** ablated re-run used more loops than baseline (consistent), across multiple
  seeds.
- **Necessity, not "waste".** `reducedCostOnRemoval` means *removing it reduced cost* — the
  piece could be load-bearing scaffolding, not a detour. The library never claims "wasted."
- **`no-detected-effect`, never "innocent".** A piece can matter in ways neither axis sees
  (overdetermination; same loops via a different path).

## Why it matters

The `cost-cause` cell is the **silent decision bug**: *right answer, but a loop overpaid*.
A correctness benchmark and a token-count dashboard both miss it; the per-loop ablation
surfaces it — the performance data the model itself won't give you.

## See also

- Runnable: [`examples/observability/12-two-score-localization.ts`](../../examples/observability/12-two-score-localization.ts)
- The localizer it extends: `localizeContextBug` (RFC-003 Part B)
- The proposal: `docs/proposals/004-two-score-localization.md`
