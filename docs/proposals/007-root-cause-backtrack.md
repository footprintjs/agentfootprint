# Proposal 007: influence-guided backtracking debugger (L4 — `walkToRoot`)

**Status:** v3 · **BUILT (algorithm) + REAL-AGENT DESCENT GATE = RED.** Reviewed (GO-WITH-CHANGES, 7
must-fixes folded), then built — `walkToRoot`/`walkTrajectory` + the `writerId→frame` resolver + 11
tests + example 15, af suite 3062 green. **The decision-bug GATE is validated SYNTHETICALLY** (the
deterministic test proves the proximate→root descent works when the trajectory surfaces a tool-output
proximate). **But the REAL-agent descent does NOT fire** — confirmed empirically: a real flat agent's
`call-llm` reads `history` (aggregate), not `lastToolResult`, so the trajectory surfaces ONLY injection
suspects (root-seeded), no hoppable tool proximate. So L4's novelty (the multi-hop cross-loop descent)
is unvalidated on real agents; on a real run it convicts the injection root at the symptom (correct, but
equivalent to single-trigger localize). **The unblock (follow-up): enrich `assembleTrajectory`/the
classifier to surface tool-output provenance as suspects.** Export-vs-internal is the maintainer's
measure-before-promote call (held uncommitted with the fp 9.9.0 batch).


> **Review outcome (2026-06-16, two-lens, source-verified).** Build it — but flat-charts-first, with
> a real beam hop, honest about what it can't reach. The 7 must-fixes:
> 1. **Flat-only cross-loop hop.** Grouped frames are scope-isolated (`findLastWriter` confined to one
>    subflow's inner log) — the hop can't cross loops there; ship flat-first, degrade grouped with a flag.
> 2. **Build the `writerId → frame` resolver** as new, property-tested code — `parseRuntimeStageId`
>    gives executionIndex, NOT loopIndex; resolve by scanning which frame's `bodyIds` holds the writer.
> 3. **BEAM hop (top-k writers), not top-1.** The proxy-narrow is FA-dominated and (the eval's own
>    lesson) can't separate the planted instruction from an innocent same-topic sibling — top-1 descends
>    the wrong branch in exactly L4's motivating case. Ablation picks among the beam.
> 4. **No loop-scoped ablation exists** — per-hop convict = the EXISTING run-wide `ablationForSuspect`
>    targeted at the hop's suspect. root = deepest hop whose run-wide ablation flips.
> 5. **The eval is the UNMET GATE, not a precedent.** `eval-decision-bug.mjs` fakes the hop with a regex
>    + hardcodes `writerId:'w'` — the genuinely-new provenance hop is UNMEASURED. Rewire it through the
>    REAL pieces (real agent → assembleTrajectory → shortlist → writerId beam-hop → run-wide ablation,
>    root = planted instruction where flat-localize stops at the proximate). Green = export; red = internal.
> 6. **Three honesty flags as first-class outputs:** unseparated-siblings (reuse the margin<0.05 pattern),
>    overdetermined-or-incomplete (single-candidate ablation false-negative), untracked-origin (no writerId).
> 7. **Sibling serializer** `toRootCausePathTrace` — don't overload single-report `toBacktrackTrace`.
> Name → `walkToRoot` (honest: the walk MAY NOT reach a causal root). Plain fields (`writtenBy`/`cameFrom`,
> `narrowedBy: 'text-similarity'`). The deepest honesty caveat: if the narrow never surfaces the true root
> into the beam at the right loop, ablation never tests it and the walk stops shallow — the recall blind
> spot, inherited from flat-localize and amplified in a single chain. Stated, not buried.

**Status (orig):** v1 · proposed (NO implementation yet — design memo, gated on explicit "yes").
**Affects:** `agentfootprint/src/lib/context-bisect/` — a new orchestrator `traceRootCause` that
chains the SHIPPED pieces (assembleTrajectory + shortlistEarlyCulprits + localizeContextBug/ablation
+ causalChain provenance). Optionally `toBacktrackTrace` gains a path serializer. No engine change,
no new scorer, no new ablation — L4 is the WALK, not a new measurement primitive.
**Estimated change:** ~150–250 LOC (the multi-hop walk + the RootCausePath type) + tests + example.
**Grounded in:** `ctxbug/harness/eval-decision-bug.mjs` — the decision-bug arc (root ≠ proximate)
this formalizes, and its three-tier conclusion: "proxy text-influence NARROWS; only ablation ISOLATES."

---

## One-liner

> Start at the symptom, **walk backward across loops** — narrow with influence (L3), hop along
> provenance to the loop where the wrong decision was made, and **convict with ablation (L2)** —
> until you reach the ROOT context source, not the proximate one.

## The problem it solves (root ≠ proximate)

`localizeContextBug` localizes ONE trigger: "for this step, which context source is the culprit?"
For a **content bug** that's enough. But for a **decision bug** the root and the proximate cause
are different loops (the user's motivating case): a misdirecting instruction in loop 1 makes the
agent call the WRONG tool; the wrong tool's output (loop 2+) is what resembles the final answer.

`eval-decision-bug.mjs` measured exactly this three-tier behavior:
- **PLAIN influence** → finds the PROXIMATE (the wrong tool's output resembles the answer); buries the root.
- **CHAINING (hop)** → hops to the wrong-choice loop, narrows to the right NEIGHBORHOOD — but
  text-similarity can't separate the planted instruction from an innocent same-topic tool description.
- **ABLATION** → isolates the ROOT: remove it → outcome flips; remove the innocent → it holds.

`localizeContextBug` + `toBacktrackTrace` give the FLAT, single-trigger view. There is no function
that performs the **multi-hop guided walk** from symptom to root. L4 is that walk.

## The design — a guided backward walk (orchestration over shipped pieces)

```ts
walkToRoot(artifacts, {
  embedder,                 // for the per-hop narrow
  rerun,                    // AblationRerun — the convict tier (without it: correlational walk, no root claim)
  beamK?,                   // top-k writers ablated per hop (default 2) — NOT top-1 (must-fix #3)
  recencyDecay?, k?,        // forwarded to shortlistEarlyCulprits
  maxHops?, maxAblations?,  // budgets — honesty-flagged if hit
}): RootCausePath
```

FLAT charts only for the cross-loop hop (grouped loop frames are scope-isolated — degrade with a flag).
The walk, per hop, reusing the shipped tiers:
1. **NARROW.** `shortlistEarlyCulprits` ranks the per-loop candidates → the small set that plausibly
   drove THIS loop's decision. (Correlational, FA-dominated — it points at a neighborhood, never "because".)
2. **HOP (provenance, BEAM).** Each candidate `ContextSource` carries `writtenBy` (`writerId`, proposal
   005). A NEW `writerId → frame` resolver maps a writer to the frame whose `bodyIds` contains it (NOT
   `parseRuntimeStageId`, which gives executionIndex; `LoopFrame.loopIndex` is a derived ordinal). Because
   the proxy can't separate same-topic siblings, follow the **top-`beamK`** writers (not just top-1) and
   let ablation decide which hop convicts. `causalChain`/`controlDeps` supply the cross-mount edges.
3. **ISOLATE (run-wide ablation).** There is NO loop-scoped ablation — at each hop, run the EXISTING
   run-wide `ablationForSuspect` on the hop's suspect against a stable baseline. `root` = the DEEPEST hop
   whose run-wide ablation flips the outcome (and no deeper hop convicts).

Output — the ordered walk (plain field names):

```ts
interface RootCausePath {
  readonly hops: readonly RootCauseHop[];   // symptom → … in walk order
  readonly root?: RootCauseHop;             // deepest ablation-convicted hop (CAUSAL); absent without a flip
  readonly honestyFlags: readonly HonestyFlag[];
  readonly truncated?: { readonly byHops: boolean; readonly byAblations: boolean };
}
interface RootCauseHop {
  readonly loopIndex: number;               // which loop this hop examined
  readonly suspectId: string;               // the narrowed culprit (joins a Suspect 1:1)
  readonly narrowedBy: 'text-similarity';   // the correlational narrow (plain name, not 'influence')
  readonly verdict?: AblationVerdict;       // the causal convict — present only with `rerun`
  readonly writtenBy?: string;              // the provenance writer this hop's culprit came from
  readonly cameFrom?: number;               // the loopIndex the walk descends to next (resolved frame)
  /** 'unseparated-siblings' | 'overdetermined-or-incomplete' | 'untracked-origin' — honest stops. */
  readonly note?: string;
}
```

## Honesty (claims discipline — the proxy CAN misdirect the hop, and we say so)

- **Narrow = correlational PROXY** (FA-dominated cosine-to-loop-output). The eval's measured lesson:
  it CANNOT separate the planted instruction from an innocent same-topic sibling — so a hop can be
  pointed at the wrong neighbor. The three guards that make the design survive this, named together:
  1. **Beam, not top-1** — keep the same-topic candidates in play; don't follow one blindly.
  2. **Ablation is the only discriminator** — a wrong-branch hop that doesn't flip is never `root`.
  3. **Reorder-not-filter** (localize.ts) — the narrow never DROPS the true suspect, only reorders it.
- **The remaining caveat (stated, not buried):** if the narrow never surfaces the true root into the
  beam at the right loop, ablation never tests it and the walk stops shallow — a recall blind spot
  inherited from flat-localize and AMPLIFIED in a single chain. The gate must pin this on a fixture.
- **Root = causal, ablation-only.** `root` is set ONLY when run-wide ablation flips on a stable
  baseline. Without a `rerun`, the walk is correlational and `root` is absent.
- **Three first-class honest stops** (never silent): `unseparated-siblings` (top-2 within margin<0.05,
  reuse toBacktrackTrace's pattern), `overdetermined-or-incomplete` (single-candidate ablation gives a
  FALSE not-confirmed under a redundant co-cause → never return empty "no root"), `untracked-origin`
  (a hop lands on a root-seeded source with no `writtenBy` → terminate honestly).
- **Provenance hops are real edges** — `writerId`/`causalChain` are recorded read→write links, not
  similarity. The proxy is only the per-hop narrow.

## Non-goals

- NOT a new scorer (reuses L3) or a new ablation (reuses L2 run-wide). L4 is the orchestration.
- NOT a multi-culprit search. When a hop's run-wide ablation does NOT flip but a redundant SET might,
  L4 HANDS OFF to `bisectCulprits` rather than fabricate a single root. (Keeps "follows ONE chain" sharp.)
- **Cross-loop hop is FLAT-only** for now — grouped charts degrade to within-one-loop with a flag.
- NO new engine features.

## Validation (Convention 2/3 — measure-before-promote) — the gate is UNMET today

- **The current eval is NOT a precedent — it's the bar to clear.** `eval-decision-bug.mjs` fakes the
  hop with a regex (`/^toolout-.*-(\d+)$/`, which can never match the suffix-less instruction root) and
  hardcodes `writerId: 'w'` — so the genuinely-new provenance hop is UNMEASURED. It proves the ARC, not
  the mechanism.
- **The promotion GATE (must pass before export):** rewire the decision-bug fixture through the REAL
  pieces — a real agentfootprint agent → `assembleTrajectory` (real `writerId`) → `shortlistEarlyCulprits`
  → the beam `writerId` hop → run-wide ablation — and show `root` = the planted misdirecting instruction
  where flat `localizeContextBug` stops at the proximate (`get_promo`) output. Red = stays internal.
- 7 test types: unit (one hop); functional (root≠proximate on a planted decision bug); **property** —
  the walk ALWAYS terminates and never revisits a `(suspectId, loopIndex)` (writerId edges point strictly
  backward via exclusive beforeIdx; loopIndex monotone non-increasing), AND the resolver invariant
  (every `writerId` lands in exactly one frame or the prelude); integration (real agent → walk → root
  convicted); security (redaction passthrough); perf/load (the `maxHops × beamK` ablation budget capped).
- Runnable `examples/`: plain influence blames the proximate tool output; `walkToRoot` walks back to the
  planted instruction, ablation-convicted.

## Builds on (shipped) vs genuinely new

- **Shipped:** `assembleTrajectory` (frames + `writtenBy`/`writerId` provenance, FLAT path crosses loops),
  `shortlistEarlyCulprits` (narrow), `ablationForSuspect`/`runAblationProbe`/`verdictFor` (run-wide
  convict), `causalChain`/`controlDeps` (cross-mount edges), `toBacktrackTrace` (the existing single-report
  serializer — a SIBLING, not extended).
- **Genuinely new:** the `writerId → frame` resolver, the beam multi-hop walk (narrow → beam-hop →
  run-wide convict), the terminate/cycle/overdetermination logic, the `RootCausePath` shape, the
  `toRootCausePathTrace` sibling serializer.

## Open questions — RESOLVED by review

1. **Name → `walkToRoot`** (honest: the walk may NOT reach a causal root — it can return no-root /
   overdetermined / untracked-origin). Plain fields (`writtenBy`, `cameFrom`, `narrowedBy:'text-similarity'`).
2. **Hop → BEAM (top-`beamK`, default 2), not top-1** — top-1 descends the wrong same-topic branch in
   exactly L4's motivating case (the eval's own measured lesson); ablation picks among the beam.
3. **Stop rule → deepest ablation-convicted hop** (continue while a deeper hop convicts), cycle-guarded
   by a visited-set + the strictly-backward invariant; budget-capped; honest stops on the three flags.
4. **Serializer → a NEW `toRootCausePathTrace` sibling** (Convention 1) — do not overload `toBacktrackTrace`.
