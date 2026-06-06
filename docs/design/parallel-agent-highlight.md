# Parallel-agent highlight — design pass

Status: **DESIGN MEMO — for sign-off. No code yet.**
Author: design review, 2026-06-05. Follows the SHIPPED slot parallel-highlight
(see `time-travel-milestones.md`) and extends it to multi-agent parallel branches.

Read with:
- `agentfootprint/docs/design/time-travel-milestones.md` — milestones + the SHIPPED slot collapse
- `agentfootprint-lens/src/core/group/cursorPositionsAtDrill.ts` — `coActiveGroupIds` + slot-cohort collapse
- `agentfootprint-lens/src/core/group/cursorPositionsAtDrill.test.ts` — the canonical Parallel-of-2-LLMCalls fixture (`sf-Committee` → legal ‖ ethics + merge)

---

## 1. The goal

Render a parallel-AGENT fork (e.g. a Committee running `legal ‖ ethics`, or a
Self-Consistency fan of N samples) as ONE time-travel stop where **all concurrent
branches light at once** — the same simultaneous highlight the context slots now
get. Generalize the slot mechanism to agent/LLMCall branches.

## 2. What the investigation found (the premise was wrong)

The slot collapse worked because each slot is a real SUBFLOW group with a
milestone stop, so the lens could cluster the consecutive stops and light them
together. Parallel-AGENT patterns in the playground do NOT have that shape:

- **`/samples/parallel` (control-flow):** nodes `seed, legal, ethics, merge` —
  all plain top-level `stageNode`s. Slider stops: `seed`-ish + `merge` only.
  `legal`/`ethics` get NO cursor stop and **never light**.
- **`/samples/self-consistency`:** nodes `seed, sample-0..4, merge` — same story.
  The 5 branches are top-level nodes with NO stops; only `seed` + `merge` light.

So it is NOT "collapse one-by-one INTO together" (there is nothing being stepped
through). The branches are not group-backed, so there is nothing to light. This
is a bigger gap than the slots.

## 2b. CORRECTION (2026-06-05, post-diagnosis): branches are ALREADY subflow-backed

A follow-up diagnosis CONTRADICTS §3 R1's premise. The agentfootprint `Parallel`
primitive mounts every branch via **`addSubFlowChart`** (Parallel.ts ~390-398) —
`isSubflowRoot: true`, fires subflow-mounted — so each branch DOES emit
`subflow.entry`/`subflow.exit` → a boundary → a Group. Self-Consistency + the
control-flow Parallel both route through it. So **R1 is already satisfied** — the
branches are group-backed at runtime.

YET in the browser those branches had NO cursor stops and never lit, and rendered
as FLAT plain `stageNode`s (not group/subflow-styled). So the real gap is
**lens-side**, not builder-side:
- the pattern chart appears to render a FLATTENED viz that doesn't carry the
  branch GROUPS into the rendered nodes (viz-vs-runtime split), and/or
- the branch groups sit under the Parallel composition, so `cursorPositionsAtDrill`
  only surfaces them on DRILL-IN, not at the top level where the nodes are drawn.

NEXT STEP (revised): a focused lens diagnosis — for a pattern run, dump
`buildGroups(boundaryIndex)` + `cursorPositionsAtDrill` at each drill level, and
check `structureGraphFromRunner`'s node↔group mapping — to find why the
already-existing subflow-branch groups don't surface as stops / don't light. THEN
reuse the shipped slot collapse. The R1/R2 framing below is superseded by this
correction for the "group-backed" part; R2 (homogeneous fan-out node ids) still
stands.

## 2c. ROOT CAUSE + the CLEAN fix (2026-06-05): derive grouping from the BUILD-TIME structure

Patching the runtime-boundary grouping is unreliable (verified: the parallel-branch
co-active patch did NOT light `legal`/`ethics` in the control-flow Parallel sample —
only `seed`/`merge`). The runtime-boundary reconstruction in the lens
(`buildGroups(recorder.boundary.boundaryIndex)`) is the OLD logic, and it is BUGGY:
- The Parallel composition's group `runtimeGroupId` is literally `seed#0` (the seed
  stage), not a clean composition id.
- The hierarchy is FLATTENED: every descendant (branch → its LLM-call → its slots)
  gets `parentGroupId = seed#0` (the composition), at depths 1/2/3 — so drilling in
  shows a flat mix, and branch nodes render at one level while their groups sit one
  level deeper (the level mismatch that stops them lighting).

THE CLEAN FIX (user's direction — "footprintjs already sends the build structure
through the build-time recorder; wrap the grouping to derive from it"):
**derive the lens Group tree from footprintjs's BUILD-TIME structure**, not from
runtime boundary events. footprintjs already provides the AUTHORITATIVE hierarchy:
- `FlowChart.buildTimeStructure: SerializedPipelineStructure` (footPrint
  src/lib/builder/types.ts:50-77) — carries `type`
  ('stage'|'decider'|'selector'|'fork'|'subflow'|'loop'), `children`, `next`,
  `subflowStructure` (nested), `isSubflowRoot`. Correct parent/child by construction.
- The build-time `StructureRecorder` (onStageAdded/onEdgeAdded/onSubflowMounted with
  the full `subflowSpec`, + `walkSubflowSpec` from footprintjs/trace) is the
  streaming equivalent.

So `buildGroups` should be rebuilt to walk `buildTimeStructure` (correct hierarchy,
correct composition/fork/subflow types) and ANCHOR each group to its runtime commit
range (keep the commitIdx anchoring for the cursor) — instead of inferring parents
from boundary depths. This fixes the flattening + level mismatch at the source, and
the parallel-branch co-active (and slot cohort) then fall out naturally without the
`parallelBranchIds`/cluster heuristics. This is a FOUNDATIONAL lens refactor —
deserves its own design pass + test sweep. The `parallelBranchIds` patch stays as a
correct-but-insufficient interim (works for clean fixtures; superseded by this).

## 3. Two requirements before any collapse can work (R1 SUPERSEDED — see §2b)

### R1 — branches must be GROUP-BACKED  [ALREADY TRUE via Parallel.addSubFlowChart]
The lens's milestone/co-active machinery keys on GROUPS (subflow/composition
boundaries) + their member commits. The slot collapse fires only for a true
`compositionKind: 'Parallel'` group whose children are SUBFLOWS (the canonical
`sf-Committee` fixture). The function-based patterns produce no such groups.

**Design question (the crux):** should the pattern builders (Parallel /
Self-Consistency / Debate / Swarm / ToT / MapReduce) model each parallel branch
as a SUBFLOW (so it emits a boundary → a group → a milestone stop)? Today they
mount plain functions. Making each branch a subflow:
- ➕ gives every branch a group → the lens lights it; drill-in to inspect each;
  consistent with the slot model; the existing `coActiveGroupIds` collapse reuses
  verbatim.
- ➖ more boundary events per run; changes the chart shape for every pattern;
  a per-branch subflow for a trivial function may be heavyweight.

Alternative: keep branches as plain stages but have the lens treat a Parallel
composition's plain-stage children as a co-active cohort (light them by node id
without requiring subflow groups). Lighter, but the lens must read the Parallel
composition's child STAGE ids (not just groups) — a new path.

### R2 — identical N-way fan-out shares ONE chart node id
`addListOfFunction` / Self-Consistency fan out N IDENTICAL branches. Merge-tree
chart node ids are build-time `[subflowPath/]stageId` with NO `#executionIndex`,
so 5 instances map to ONE node → "light all 5" renders as "light 1." Options:
- (a) give fan-out instances per-instance node ids (`stage#0..#4`) at build time —
  the chart draws N nodes, each lights; biggest change.
- (b) light the single shared node + show a "3/5 done" count badge — cheap, keeps
  one node; honest about progress without N nodes.
- (c) scope out homogeneous fan-out; support only heterogeneous (distinctly-named)
  branches. Smallest; Committee/Debate work, Self-Consistency does not.

## 4. The mechanism (already built — reuse it)

Once R1 holds, the collapse is the SHIPPED slot path generalized: in
`cursorPositionsAtDrill`, cluster a Parallel composition's concurrent branch
groups (overlapping commit ranges) into ONE `kind:'parallel'` stop with
`coActiveGroupIds` = the branch ids; a non-overlapping trailing child (the merge)
stays its own stop. Lens.tsx resolves `coActiveGroupIds` → node-id set →
`data.active` on each → explainable-ui consumer-OR seam lights them together. ONE
cursor preserved (anchor = earliest branch; co-active is chart-only highlight).
Drill into a branch to inspect it individually (the hybrid).

**Where to collapse:** at the level where the branch NODES are visible. For the
slots that was the top level (slots are root children). For a Parallel composition
whose branches are children of the composition, it is the DRILLED-IN view
(`current.compositionKind === 'Parallel'`). Note: this changes the existing
drilled-in one-by-one behaviour — the Parallel fixture tests in
`cursorPositionsAtDrill.test.ts` would be updated to expect the collapsed shape.

## 5. One-cursor + UX (unchanged from the slot decision)

- One cursor (single `runtimeStageId`/`commitIdx`); the co-active set is
  chart-only highlight; commentary/details/trace stay on the canonical cursor
  with fork-level content.
- Hybrid: ONE collapsed stop to see branches together + drill into a branch to
  inspect it. (Do NOT also collapse the branch's OWN internals.)

## 6. Recommendation

1. Decide R1: **make parallel branches subflow-backed** in the pattern builders
   (preferred — consistent with slots, reuses the shipped collapse, enables
   drill-in), OR the lighter lens-reads-plain-children path. Lean: subflow-backed.
2. Decide R2: start with **(c) heterogeneous-only** for the first cut (Committee /
   Debate light together), then add **(b) count badge** for homogeneous fan-out;
   defer **(a) per-instance node ids**.
3. Then implement the collapse (reuse the slot mechanism) + update the Parallel
   fixture tests + browser-verify on a pattern that actually uses subflow branches.

## 7. Open questions

1. Which patterns SHOULD show branches lit together vs. stay summarised at the
   parent (e.g. MapReduce with 100 shards — light all? or a count)?
2. Is per-branch drill-in wanted for inspection, or is the collapsed view enough?
3. Does footprintjs/agentfootprint already have a "parallel subflow branch"
   primitive the patterns can adopt, or do the builders need a new helper?
