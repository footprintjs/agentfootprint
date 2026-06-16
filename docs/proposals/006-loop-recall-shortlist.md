# Proposal 006: per-loop recall shortlist (L3 — the validated subset of 003)

**Status:** v3 · **BUILT + GATE-VALIDATED.** Reviewed (GO-WITH-CHANGES, 5 must-fixes folded in),
then built — and the recall@k gate caught a real mechanism error (see Build outcome). Held
uncommitted, batching with the footprintjs 9.9.0 release (the grouped path + L3's grouped test
need the dual-key fp).

> **Build outcome (2026-06-16) — the gate earned its place.** v1 of the build shipped a FORWARD
> eligibility sum (`credit_N = score_N + carryForward·credit_{N-1}`). The recall@k gate measured the
> REAL scorer against the H2 prototype and it **FAILED**: forward UP-weights early loops → top-3
> **4/10**. The H2 winner is a BACKWARD recency-weighted sum (`recencyDecay^(lastLoop−N)`), so that
> is what ships. Re-run: REAL `shortlistEarlyCulprits` at `recencyDecay=0.5` → top-3 **10/10** vs
> plain 9/10 (and 0.7 → 10/10; ≥0.9 → 9/10) → **GATE PASS**. The param is `recencyDecay` (default
> 0.5, validated band [0.5,0.7]); the "forward flow / rescue early" framing was replaced by the
> honest one: the per-loop signal surfaces culprits the FINAL ANSWER buries. 17 tests + example 14,
> full af suite 3051 green.

> **Review outcome (2026-06-16, two-lens, source-verified).** Both lenses: build-with-changes.
> Five mandatory pre-conditions, two of which are real source-level gaps confirmed against code:
> (1) the shortlist↔suspect JOIN (LoopCandidate must carry the suspect identity, not the slot
> state-key); (2) narrowing hook is REORDER-only, never hard-intersect; (3) λ default must be a
> MEASURED value (0.3 was below the swept grid); (4) literal honesty-flag passthrough;
> (5) the recall@k gate runs the REAL scorer and FAILS promotion if it doesn't reproduce H2.
> Naming + λ + combinator resolved (see §API, §Open-questions-resolved). The deepest honesty note:
> the recall was measured on a BACKWARD recency sum; v1 ships a FORWARD eligibility sum — the gate
> (#5) is what makes that claim honest, and the proposal says so.

**Affects:** `agentfootprint/src/lib/influence-core/` (a new pluggable scorer alongside
`scoreInfluence` / `scoreContrastiveInfluence`) consuming the `Trajectory` from
`assembleTrajectory` (proposal 005, shipped). Optionally `localizeContextBug` gains a
`shortlist` narrowing hook. No engine change.
**Estimated change:** ~150–250 LOC (the λ-eligibility aggregation over per-loop frames +
the shortlist projection) + tests + example. No new model loop.
**Supersedes (scope-narrows):** proposal 003. This is 003 trimmed to the ONE thing the
benchmark validated; the rest of 003 is explicitly deferred (see §Non-goals).
**Grounded in:** the H2 measurement (`ctxbug/docs/findings-multiloop.md`).

---

## One-liner

> A per-loop influence scorer that **rescues early-entered culprits into the top-k shortlist**
> so ablation has the right candidates to convict — a **recall booster that narrows before
> ablation, NOT a #1 ranker.**

## The validated finding (why this scope, and not more)

H2 measured a per-loop trajectory scorer against plain final-answer influence on the
multi-loop CTXBUG set:

- **At #1 it LOSES.** Plain final-answer influence ranks the culprit #1 in **7/10**; every
  trajectory variant is worse at #1 — intermediate decisions are terse, so per-loop text is a
  weak *ranking* signal.
- **At recall it WINS.** Low-λ trajectory gets **top-3 recall 10/10 vs plain 9/10** — it
  rescues culprits that entered context in an *early* loop and that the final-answer scorer
  buries (their text doesn't resemble the final answer).

**Implication (the validated mechanism):** *proxy/chaining NARROWS the shortlist; ablation
convicts.* L3 is the narrowing stage. It is promoted ONLY as a recall/shortlist booster — the
honest gate ("ships only if it earns its place") is met for recall, and explicitly NOT met for
#1 ranking. Shipping it as a ranker would contradict our own measurement.

## The design — one pluggable scorer over the trajectory frames

`assembleTrajectory` (005, shipped, flat + grouped) already gives ordered `LoopFrame`s, each
with its `contextSources` (the live sources that fed that loop's `call-llm`) and
`intermediateText` (what the loop produced). L3 scores each source per-loop and propagates
credit forward across loops with a λ-decayed eligibility trace, then ranks for **recall**.

```ts
shortlistEarlyCulprits(trajectory, {
  embedder,           // Embedder (deterministic mockEmbedder in tests; real embedder in prod)
  cache?,             // EmbeddingCache — MANDATED in practice (scoring is O(frames × sources))
  carryForward?,      // forward credit decay (was 'λ'); default a MEASURED value — see §λ
  k?,                 // shortlist size (default 5); recall@k is the headline metric
}): LoopRecallShortlist
```

**Per-loop score.** For each `LoopFrame` and each `contextSource`, the per-loop relevance is
`scoreInfluence` of the source's evidence vs that loop's `intermediateText` — the per-loop
anchor, NOT the final answer. This is what makes an early decisive source score where it
actually mattered.
**Honesty (confirmed in review):** `ContextSource.evidence.ancestorTexts` is `[]`
(trajectory.ts:264), and `adaptWeights` (signals.ts:143) zeroes AVG+PERSIST when there are no
ancestors and moves their mass to FA+DEPTH. With DEPTH constant (`1/(1+0)=1`), the per-loop
score is in practice **FA-dominated (cosine to the loop's own output)**, NOT a four-signal
composite. v1 documents this honestly (it's the right shape for "did this source resemble what
this loop produced"); populating per-loop `ancestorTexts` to re-activate AVG/PERSIST is a
deferred refinement, not v1.

**Forward eligibility (the one new combinator — ship exactly ONE).** A source's running credit
accumulates across loops: `credit_N(src) = perLoop_N(src) + carryForward · credit_{N-1}(src)`,
keyed on the **suspect identity** (see §Integration — same identity end-to-end so credit never
double-counts on re-convergent/grouped frames), and reset when the source leaves the loop's
context. `carryForward=0` → per-loop only. Reset on new `runId` (Convention 4). We do NOT expose
`max`/`last` combinators in v1 — only the measured `eligibility` sum earns a place.

**Rank for recall.** Aggregate to one score per source (`eligibility` sum, the default
combinator), rank descending, and return the **top-k as a shortlist** — plus each source's
per-loop track (which loop it scored in) for the debugger (L4) and UI.

## API shape (names are a proposal — plain-names review wanted)

```ts
interface LoopRecallShortlist {
  readonly candidates: readonly LoopCandidate[];  // ranked, recall-first
  readonly k: number;
  readonly carryForward: number;
  readonly honestyFlags: readonly HonestyFlag[];  // LITERAL passthrough — see §Honesty
}
interface LoopCandidate {
  /** The SUSPECT identity the default classifier emits — injectionId / toolName — so a candidate
   *  joins 1:1 with a Suspect (must-fix #1). NOT the slot state-key. */
  readonly suspectId: string;
  /** The slot/state-key it arrived through (e.g. 'systemPromptInjections'), for display. */
  readonly viaKey: string;
  readonly recallScore: number;      // normalized eligibility sum — a PROXY (correlational)
  readonly enteredLoop: number;      // first loop it fed (why recall rescues it)
  readonly perLoop: readonly { loopIndex: number; recallScore: number }[];
  /** True if the decisive loop read untracked sources or the trajectory was truncated. */
  readonly incomplete: boolean;
}
```

**The join (must-fix #1).** A `ContextSource.key` is a slot state-key (`'systemPromptInjections'`)
that expands — via `defaultSuspectClassifier` (localize.ts:142-169) — into N suspects keyed on
`detail.injectionId`/`detail.toolName`. A candidate therefore carries `suspectId` (that same
classifier identity, derived from the injection/tool records inside the slot value), so it joins
1:1 with a `Suspect`. Without this the narrowing hook silently no-ops or reorders a whole slot.

**Honest tier (unchanged identity):** `mode: 'correlational'` always — embedding geometry, a
PROXY ("plausibly carried influence forward", never "because"). The CAUSAL claim stays where it
already is: ablation, run by `localizeContextBug` on the shortlist L3 produced.

## Integration — narrow, then convict

`localizeContextBug` gains an optional `shortlist` hook: when supplied, the ranked suspects are
**REORDERED by** the L3 shortlist (joined on `suspectId` = `detail.injectionId`/`detail.toolName`)
before the ablation budget is spent, so the N ablation re-runs target the high-recall candidates
first. **REORDER-ONLY, never hard-intersect** (must-fix #2): an intersect could DROP a true
suspect L3 missed — the absence/crowding blind spot the codebase already documents on
`RankingConfidence` (types.ts:120-124). Default off (back-compat). The honest story stays exactly
the H2 mechanism: L3 narrows (recall), ablation convicts (causal).

## Honest scope & non-goals (what 003 proposed that this does NOT ship)

Deferred until a measurement earns them (measure-before-promote):

- **NOT a #1 ranker.** H2 refuted it; L3 never replaces plain final-answer influence at rank 1.
- **NO per-loop CAUSAL ablation / loop-scoped ablation contract.** 003's causal rung needs a
  new `AblationSpec` that excludes a source at a specific loop. Real net-new work; deferred.
  The causal tier remains run-level ablation in `localizeContextBug`.
- **NO stability-under-non-determinism signal.** 003's "signal 3" is the least-grounded area
  (no off-the-shelf method); a deterministic embedder gives a degenerate band anyway. Deferred.
- **NO promise/progress (Q, A=Q−V) estimators.** Inference-time Q-value estimation is a larger
  research bet; L3 ships the embedding-similarity per-loop score only.
- **NO decision-cause (context-vs-model) scoring.** Separate concern (003 §decision-node).

## Honesty (methodological — must appear in the shipped docstring)

1. **Forward sum ≠ the measured backward sum.** H2 measured a BACKWARD recency-weighted sum over
   `λ∈{0.5…1.0}`; v1 ships a FORWARD eligibility sum. The recall@k gate (below) running the REAL
   scorer is what makes the claim honest — until it reproduces H2 at the chosen default, the
   feature does not ship.
2. **FA-dominated, not four-signal.** Per-loop scoring collapses to FA+DEPTH (DEPTH constant)
   because `ancestorTexts` is `[]` — documented above. Don't claim four signals.
3. **The recall win is thin + single-setup.** 10/10 vs 9/10, n=10, one fixture, one embedder
   (bge-small), one model (Qwen3-4B), greedy; the per-loop anchor (`intermediateText`) is a signal
   the codebase itself calls weak. Public docs frame it as "a recall booster validated on a single
   small fixture," not a general result.
4. **Correlational only.** Every `recallScore` is a PROXY; the causal claim stays in ablation.

## Validation (Convention 2/3 — measure-before-promote)

- **The gate (must-fix #5): the REAL `shortlistEarlyCulprits` wired into
  `ctxbug/harness/eval-headtohead.mjs`** must reproduce H2 — **top-3 recall ≥ 10/10, strictly
  beating plain's 9/10**, at the chosen MEASURED `carryForward` default. If it doesn't reproduce,
  **the feature does not ship.** Not a stand-in; the actual shipped scorer.
- **λ/`carryForward` default (must-fix #3):** 0.3 was BELOW H2's swept grid `{0.5,0.7,0.9,1.0}`.
  Either re-measure at 0.0/0.3 on the fixture and report the band, or default to the lowest
  MEASURED winner (`0.5`) and document the validated band. No unmeasured magic number.
- 7 test types: unit (per-loop score), **property** (eligibility math: `carryForward=0` ⇒ per-loop
  only; monotonicity — raising `carryForward` never decreases a present source's credit; **no
  double-count** on a re-convergent/merging frame set, keyed on `suspectId`; reset on new `runId`),
  functional (recall booster on a planted early-culprit), integration (REORDER-only feed into
  `localizeContextBug` + works on BOTH flat and grouped trajectories), security (redaction
  passthrough — no new capture), perf/load (mandate the `EmbeddingCache`).
- Runnable `examples/influence/loop-recall-shortlist.ts`: early-entered culprit buried by plain
  influence, rescued into the top-3 by L3, then convicted by ablation.

## Builds on (shipped) vs genuinely new

- **Shipped substrate:** `assembleTrajectory` (per-loop frames, flat + grouped), `scoreInfluence`
  /`SignalScores`/`EvidenceInput`, `Embedder`, `localizeContextBug` + `runAblationProbe`,
  `rankingConfidence`, `runId` (Convention 4).
- **Genuinely new:** the per-loop anchor scoring (vs `intermediateText`, not the final answer),
  the forward λ-eligibility combinator with the no-double-count invariant over merging frames,
  the recall-first shortlist projection, and the optional `localizeContextBug` narrowing hook.

## Open questions — RESOLVED by review

1. **Name → `shortlistEarlyCulprits`** (plain-names rule: says exactly what the validated
   mechanism does — rescues early-entered culprits — without leaking "loop influence" jargon or
   implying the refuted ranker). Result type `LoopRecallShortlist`; score field `recallScore`;
   the λ option is `carryForward` (no bare Greek letter in the public API).
2. **`carryForward` default → a MEASURED value** (re-measure 0.0/0.3 on the fixture, or default
   to the lowest swept winner `0.5`); document the validated band. Never the unmeasured 0.3.
3. **Combinator → ship exactly ONE** (`eligibility` sum). No `max`/`last` until a measurement
   earns them (the recall was measured on one combinator; don't multiply unmeasured ones).
4. **`localizeContextBug` shortlist → REORDER-only**, joined on `suspectId`. Never hard-intersect.

## Build plan (on "yes")

- `src/lib/influence-core/loop-recall.ts` — `shortlistEarlyCulprits` (sibling to `contrastive.ts`,
  Convention 1); the forward `carryForward` eligibility keyed on `suspectId`; recall-first projection.
- `src/lib/influence-core/types.ts` + `index.ts` — `LoopRecallShortlist`/`LoopCandidate` exports.
- `src/lib/context-bisect/localize.ts` — optional REORDER-only `shortlist` hook joined on `suspectId`.
- `test/lib/influence-core/loop-recall.test.ts` — 7 test types incl. the eligibility property proofs.
- `examples/influence/loop-recall-shortlist.ts` — the rescue→convict demo (Convention 2).
- `ctxbug/harness/eval-headtohead.mjs` — wire the REAL scorer in; the recall@k promotion gate.
