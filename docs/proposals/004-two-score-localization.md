# Proposal: two-score localization — a context bug costs you *quality* or *cost*, scored independently

**Status:** v1.1 · proposed (NO implementation yet — revised after a two-lens review:
library-inventor + causal-attribution/agent-eval domain expert). Gated on explicit "yes".
**Affects:** `agentfootprint/src/lib/context-bisect/` (extends `localizeContextBug` + the
ablation tier with an opt-in **cost** readout beside the existing **quality** readout),
`agentfootprint/observe` (new optional fields/types). No engine change.
**Estimated change (v1):** ~200–300 LOC — a sibling cost-runner channel, a baseline+delta
cost computation **with a placebo control**, a multi-seed stability gate, a derived 2×2
classifier helper, report rendering, and a silent-decision-bug fixture. Reuses the whole
ablation pipeline.
**Grounded in:** the 2026-06-16 multi-loop benchmark (CTXBUG) — the decision-bug regime and
the "silent decision bug" (wrong tool, right answer, one loop overpaid).

---

## One-liner / positioning

> **A context bug costs you twice — a wrong *answer* (quality) or extra *cost* (loops/tokens)
> — and one ablation re-run measures both, reported as two independent scores, never blended.**

The cost score is **a weaker, honestly-gated tier than the flip** (see "Honest scope") — it
shows *removal reduced cost without changing the answer*, not that the work was "wasted."

## The problem it solves

The localizer answers one question today: *did this context piece make the answer wrong?*
(quality). The multi-loop benchmark surfaced a second, independent cost: a misdirecting piece
can make the agent take a **wrong tool-call early** and **incur extra loops/tokens** — *even
when a capable model recovers and answers correctly*. That cost is invisible to answer-only
metrics and to token-count-only dashboards. Folding it into the quality score would conflate
two distinct failure modes (wrong vs costly), which a consumer fixes differently. Convention 1
("one purpose per score") says keep them **separate**.

## The idea — one counterfactual, two independent readouts

The ablation tier already removes a suspect and re-runs the agent under seeded determinism to
see if the **answer flips**. The same re-run also reports whether the suspect **inflated the
loop/token cost**. So from **one** ablation:

- **Quality score** — did the final answer change *from correct to incorrect (or vice versa),
  judged against ground truth* when the piece was removed? (the existing flip-rate, made
  correctness-relative — see fix below).
- **Cost score** — did the loop/token cost **drop** when the piece was removed, *by more than a
  length-matched placebo removal*, with a *stable sign across seeds*? (the new, gated signal).

Two orthogonal readouts, **reported separately**, combined only by a *derived* helper into a
2×2 the consumer may override.

## Design — extends the ablation tier the way the existing tiers already extend it

The codebase's idiom is **"supply the input → unlock the tier"** (the `rerun` and
`missingContext.rerun` causal tiers gate by *presence*, never a boolean flag). Cost scoring
follows the same idiom — **no `costScoring: true` flag.**

**1. A sibling cost-runner (opt-in by presence) — do NOT widen the existing runner's return.**
`runAblationProbe` feeds the runner's `string` output straight into the embedder and the
outcome comparator; widening `AblationRunner`'s return to a union breaks that hot path. Instead
add an optional sibling that reports the re-run's cost:

```ts
type AblationRunner   = (specs, run: { seed }) => Promise<string>;      // UNCHANGED — the flip signal
type AblationCostRunner = (specs, run: { seed }) => Promise<RunCost>;   // NEW, optional sibling
interface RunCost { loops?: number; tokens?: number }                   // both optional
// on AblationRerun: add `costOf?: AblationCostRunner` (and the same on the restoration rerun).
```
Absent `costOf`, behavior is byte-identical to today (quality-only). (The agent runtime knows
its loop count via `runtimeStageId`/`loopIteration`; tokens come from the provider `usage`.)

**2. Placebo control — the cost-side analogue of "innocents hold" (MANDATORY).** Removal of
*any* piece perturbs the agent's path, so a raw loop drop is confounded with benign path
variance. For each suspect we therefore also run a **length-matched neutral-filler** ablation
(replace the suspect with inert content of equal length). The cost effect is
`costEffect = costSaved(suspect) − costSaved(placebo)`; only an effect that clears the placebo
band counts. This is exactly the discipline the flip score already enjoys from the
innocents-don't-flip check.

**3. Stability — determinism ≠ robustness.** Loop count is a low-cardinality integer; a ±1
delta is brittle. A greedy single-seed run is *exact* but statistically n=1 — it says nothing
about whether the +1 survives a perturbation. So cost is sampled across **multiple seeds (and,
where available, light prompt perturbations)** and reported as a distribution (median + IQR).
A piece earns `reducedCostOnRemoval: true` only if the **sign is stable across seeds AND the
median |effect| ≥ 1 loop (or a token threshold) AND it clears the placebo band**; otherwise
`stable: false` and it is not classified as a cost cause.

**4. `localizeContextBug` extends the EXISTING `Suspect` — no parallel type.** The per-suspect
carrier already holds `source` (the id), `verdict?: AblationVerdict`, `runs?: AblationRunStats`.
We add an optional sibling, mirroring those:

```ts
// added to the existing Suspect:
cost?: {
  reducedCostOnRemoval: boolean;   // gated by §2 + §3 (NOT "wastesLoops" — see honesty)
  loopsSaved: number;              // median effect over placebo, with…
  tokensSaved: number;
  stable: boolean;                 // sign stable across seeds AND clears placebo
};
```
`AblationRunStats` gains optional per-run cost accumulation (shared with the restoration path,
under the same always-report-variance discipline).

**5. The 2×2 is a DERIVED helper, not a stored field.** A pure exported function classifies a
suspect from the two booleans the consumer already has — composable, overridable, and free to
grow new cells without a breaking enum:

```ts
classifySuspect(s): 'content-bug' | 'cost-cause' | 'both' | 'no-detected-effect'
```

| | cost-cause (cost↓ over placebo, stable) | no cost effect |
|---|---|---|
| **answer flips (vs ground truth)** | **both** | **content bug** |
| **answer unchanged** | **cost cause** (right answer, extra loops/tokens — the "silent decision bug") | **no detected effect** |

Note the cells: the no-bug cell is **`no-detected-effect`**, *not* "innocent" — a piece can be
causal in ways neither axis sees (same loops/answer via a different path; overdetermination
where two pieces are each sufficient so neither flips alone). We never call a piece innocent.

## Public surface (plain names)

New from `agentfootprint/observe`: `RunCost`, `AblationCostRunner`, `classifySuspect`; the
existing `Suspect` gains an optional `cost?`. `formatContextBugReport` renders a **QUALITY /
COST** two-column verdict per suspect with the honest wording, e.g.
`tool-misdirect: answer = unchanged · cost = −1 loop / −120 tok over placebo (stable) → cost cause`.

## Honest scope & non-goals (revised — the cost score is a *weaker* tier)

- **The cost score is ablation-grounded (causal for the cost *delta*) but NOT parity with the
  flip.** It needs a placebo control and multi-seed stability the flip does not, and it
  establishes **necessity for the cost, not that the work was *wasted*** — removal reducing
  cost is consistent with the piece being load-bearing scaffolding, not a detour. Hence
  `reducedCostOnRemoval`, never `wastesLoops`; reports say "removing X reduced cost (answer
  unchanged)," and "wasted" never appears as a proven claim.
- **Quality is correctness-relative, not string-change.** `answerFlipped` means flipped
  *across the ground-truth boundary* (correct↔incorrect), so a *different-but-still-correct*
  answer is **not** a false content-bug. (Requires a ground-truth/graded oracle, which the
  CTXBUG fixtures supply.)
- **Cost scoring is opt-in** (supply `costOf`); absent it, the localizer is quality-only
  (today's behavior, byte-identical).
- **Not a blended score**; the 2×2 is a derived convenience, the two scores are the truth.
- **Latency excluded** (noisier than loops/tokens) — consumer's own metric if wanted.
- Overdetermination caveat inherited; surfaced specifically on `no-detected-effect`.

## Validation plan (CTXBUG, library-first) — pre-registered, with the controls the review demands

- **Silent-decision-bug fixture** (net-new): a misdirection that makes the agent call a wrong
  tool early but **recover to the right answer**. *The day's findings warn this regime may be
  hard to induce on an overconfident model* (it tends to the extremes: ignore the misdirect →
  no cost effect, or commit → answer flips). So we **pre-register a trajectory predicate** and
  **pre-commit to non-inducibility as a publishable finding**:
  > success demonstrating the `cost-cause` cell = (final answer correct AND unchanged on
  > removal) AND (the with-piece trace actually contains the wrong-tool call followed by a
  > corrective loop) AND (removal eliminates that call and the extra loop) AND (the
  > length-matched placebo shows ~0 cost effect) AND (sign stable across seeds). All five.
  If the model will not reliably recover-after-wrong-tool, we report that honestly and, if
  needed, use a **forced-wrong-tool harness** (a task structurally requiring one wrong call
  before the right tool is revealed) to make the cell reproducible without relying on fragile
  self-recovery.
- **Negative cells, measured not assumed:** content bugs must show **no** cost effect over
  placebo (if a content-bug removal jiggles loops above placebo, the cost score has a
  false-positive problem); innocents show neither.
- Report the 2×2 distribution across the benchmark — the paper's two-cost table.

## Net-new vs reused

**Reused:** `runAblationProbe`, seeded re-runs, `verdictFor`/stability gate, the
`localizeContextBug` pipeline, the existing `Suspect`/report shapes, the influence scorer
(narrowing), the existing placebo-filler idea (the flip tier already discusses length-matched
neutral filler). **Net-new (small):** the `costOf` sibling runner + `RunCost`, baseline+delta
cost with the placebo control, the multi-seed cost-stability gate, optional `cost?` on
`Suspect`, the derived `classifySuspect`, the report column, and the silent-decision-bug fixture.

---

*Gated: no code until an explicit "yes." Revised once through the inventor + domain-expert
lenses; the cost tier is now honestly demoted and gated. React, then build.*
