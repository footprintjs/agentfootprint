# Proposal 008: trajectory tool-output provenance (unblock L4's real-agent descent)

**Status:** v3 · **BUILT (component-validated).** Reviewed (GO-WITH-CHANGES, 5 must-fixes folded),
then built per the walk-only design: `LoopFrame.proximateToolSource` (flat-only, guarded, `proximate:true`)
+ `writtenByOf` reads it + the walk descends via the proximate edge. 13 walk tests + the enrichment +
L3-unchanged tests + example 15; af suite 3064 green. **L4's real-agent descent is UNBLOCKED**, proven
at the COMPONENT level (the enrichment populates the cross-loop edge on a REAL trajectory — `writerId =
tool-calls#k` — AND the algorithm descends on it). L3 is provably untouched (walk-only). **END-TO-END
GATE PASSES** (`ctxbug/harness/eval-l4-walk.mjs`): on a real agentfootprint misdirect agent with the bge
embedder + a real causal ablation (rebuild without the plant → flip), the walk buries the plant at the
symptom, DESCENDS via the proximate tool edge to the wrong-decision loop, and ablation convicts `root =
the planted instruction` — where flat localize does not. **L4 PROMOTED.**

> **Review outcome (2026-06-16, two-lens, source-verified).** Mechanism CONFIRMED correct
> (`findLastWriter` exclusive-`llmCallArrayIdx` → the prior-loop `tool-calls#k` writer; `commitValueAt`
> → `{toolName,result}`; redaction rides the existing already-scrubbed path; every downstream consumer
> already handles it). Five must-fixes:
> 1. **WALK-ONLY by default (the decisive change).** `writtenByOf` (L4) AND `suspectsOf` (L3) BOTH read
>    `frame.contextSources` — so adding the tool source there makes L3 score it too (crowding risk).
>    Instead, surface it on a SEPARATE `LoopFrame` field (`proximateToolSource`) that `writtenByOf`
>    consults but `suspectsOf` IGNORES. L4 gets 100% of its descent; L3's scored pool is untouched → no
>    regression risk. Promote into shared `contextSources` only if a real gate proves L3 holds.
> 2. **The cited L3 gate is a NO-OP.** `eval-headtohead.mjs` builds its trajectory via a hand-built
>    `toTrajectory(run)` that NEVER calls `assembleTrajectory` — re-running it proves nothing. Build a
>    REAL-pipeline gate (real flat agent → `assembleTrajectory` → shortlist → localize), baseline first.
> 3. **Honesty flag:** `call-llm` reads `history`, not `lastToolResult` — the source is an INFERRED
>    proximate, not a direct read. Mark it `proximate: true` so the two-tier honesty stays intact.
> 4. **Guard loop-0 / undefined-value:** skip when no prior writer OR `commitValueAt` returns undefined.
> 5. **Flat-only:** fire only when `subflowScope === undefined` (grouped's run-level `lastToolResult` is
>    outside the per-scope inner logs — deferred, degrade-flagged).
> Scope guard: v1 = `lastToolResult` only; "all tool results in history" is a separate gated follow-up.

**Status (orig):** v1 · proposed (design memo).
**Affects:** `agentfootprint/src/lib/context-bisect/trajectory.ts` (`assembleTrajectory` surfaces the
proximate tool result as a contextSource). No engine change, no chart change, no new scorer/ablation.
**Estimated change:** ~30–60 LOC + tests. Unblocks L4 (`walkToRoot`) — turns its real-agent
decision-bug gate from RED to GREEN.
**Grounded in:** the L4 build finding — a real flat agent's trajectory surfaces ONLY injection
suspects, so the multi-hop cross-loop descent never fires.

---

## The problem (why L4's descent is red on real agents)

`walkToRoot` (L4) descends from the proximate tool output to the root instruction by hopping along
`ContextSource.writerId` provenance. But the agent's `call-llm` reads `history` (the message
aggregate), NOT `lastToolResult` — so `assembleTrajectory` surfaces no tool-output suspect to hop
from. Confirmed empirically: a real flat agent yields only the injection suspect per loop, so the
descent never fires; `walkToRoot` convicts the injection at the symptom (= single-trigger localize).

Verified facts the enrichment stands on:
- `lastToolResult` IS committed to the run commit log, written by the **tool-calls stage** (e.g.
  `tool-calls#22`) — a per-loop, cross-loop-addressable `runtimeStageId`.
- `defaultSuspectClassifier` ALREADY maps `lastToolResult` → a `'tool'` suspect (localize.ts:172-185).
- `walkToRoot`'s `writtenByOf` ALREADY handles the `{ toolName, result }` shape; `buildWriterFrameIndex`
  maps a `tool-calls#k` writer to the frame whose `bodyIds` contains it (the producing loop).

So the only missing link is: the trajectory doesn't EXPOSE the tool result as a contextSource.

## The enrichment (one additive contextSource per frame)

In `assembleTrajectory` (FLAT frames only — `subflowScope === undefined`), surface the PROXIMATE tool
result — the most recent `lastToolResult` committed before this loop's `call-llm` — on a SEPARATE,
WALK-ONLY `LoopFrame` field (NOT in `contextSources`, which L3 scores):

```ts
// proximateToolSource: read by walkToRoot's writtenByOf; IGNORED by L3's suspectsOf.
const writer = findLastWriter(commitLog, 'lastToolResult', llmCallArrayIdx); // the producing tool-calls stage
const widx = writer ? lastIdxOf.get(writer.runtimeStageId) : undefined;
const value = widx !== undefined ? commitValueAt(commitLog, widx, 'lastToolResult') : undefined;
if (writer !== undefined && value !== undefined) {        // loop-0 / pre-run guard (must-fix #4)
  frame.proximateToolSource = {
    value,                                                 // { toolName, result }
    writerId: writer.runtimeStageId,                       // tool-calls#k — a CROSS-LOOP provenance edge
    proximate: true,                                       // honesty: inferred (call-llm read history, not this)
  };
}
```

`walkToRoot.writtenByOf` reads `frame.proximateToolSource` (mapping `toolName → writerId`) so the
descent hops to the producing loop's frame; `buildWriterFrameIndex` resolves `tool-calls#k` → that
frame. L3's `suspectsOf` never sees it → **L3's scored pool, and its measured top-3 10/10, are
untouched.** Promotion into shared `contextSources` (so L3 also surfaces tool suspects) happens ONLY
if the real-pipeline gate proves the planted injection still ranks top-3 with the tool source present.

## Why this is the right edge (honest)

- **`findLastWriter` with the EXCLUSIVE `llmCallArrayIdx`** gives the tool result the call-llm's
  decision was conditioned on — the PROXIMATE, written in an EARLIER loop. That is precisely the
  cross-loop edge L4 needs; it is a recorded read→write link, not a similarity proxy.
- **Additive + non-breaking.** It adds one contextSource; the existing injection contextSources are
  untouched. Flat charts only for the cross-loop writerId (the grouped run-level `lastToolResult`
  lives outside the per-scope inner logs — a follow-up; degrade-flagged, consistent with L4).
- **No double-surfacing.** `lastToolResult` is added only when a writer exists before the call-llm
  (loop 0 has none → no spurious tool suspect).

## Validation (Convention 2/3 — measure-before-promote)

- **BUILD THE REAL-PIPELINE GATE FIRST (must-fix #2).** The existing `eval-headtohead.mjs` hand-builds
  its trajectory (`toTrajectory(run)`) and NEVER calls `assembleTrajectory` — so it cannot see the
  enrichment; re-running it is a false safeguard. Build a gate that runs a REAL flat agent →
  `assembleTrajectory` → `shortlistEarlyCulprits` → `localizeContextBug`, and BASELINE the recall with
  no enrichment. Nothing ships before this is green-baselined.
- **L4 gate → GREEN on a REAL agent:** a real flat misdirect run → `assembleTrajectory` (now with the
  walk-only proximate tool source) → `walkToRoot` descends through `tool-calls#(k-1)` to `root = the
  planted instruction`, where flat-localize stops at the proximate. This is what PROMOTES L4.
- **L3 unchanged (walk-only ⇒ trivially):** because the tool source is walk-only (NOT in
  `contextSources`), L3's scored pool is unchanged → recall identical. Confirm on the real-pipeline gate.
  (Only the optional shared-promotion path needs a re-measured recall number.)
- 7 test types: unit (`proximateToolSource` set with the right `writerId`; absent for loop-0/undefined),
  functional (real/scripted decision-bug run → walkToRoot descends to the instruction root), property
  (no source when none precedes the call-llm; flat-only; a zero-tool-call loop → descent still
  backward-correct), security (redaction passthrough — `value` from `commitValueAt`, already scrubbed),
  perf (the extra `findLastWriter` per frame is O(frames×N) — note it), integration.
- Example: update example 15 to run on a REAL scripted misdirect agent (not a synthetic trajectory),
  showing the descent firing end-to-end.

## Open questions — RESOLVED by review

1. **Scope → `lastToolResult` only (the proximate).** Multi-tool (all `history` results) multiplies
   answer-resembling distractors → a separate gated follow-up. Dedup by `toolName` so a `history`-derived
   path can't double-count the same output.
2. **L3 interaction → WALK-ONLY (the source is NOT in `contextSources`).** L3's scored pool is
   unchanged → no crowding, no recall regression. Shared promotion only after a real-pipeline gate proves
   top-3 holds.
3. **Grouped → deferred, flat-only v1** (degrade-flagged, consistent with L4).

## Build plan (on "yes")

1. Build the REAL-pipeline gate (real flat agent → assembleTrajectory → shortlist → localize); baseline recall.
2. `trajectory.ts`: add `LoopFrame.proximateToolSource` (flat-only, loop-0/undefined guarded, `proximate:true`).
3. `walk-to-root.ts`: `writtenByOf` also reads `proximateToolSource`; verify the descent fires on a real agent → L4 GREEN.
4. Re-run the gate with enrichment on → confirm L3 recall identical (walk-only ⇒ trivially).
5. Tests (7 types incl. the zero-tool-call property) + rewrite example 15 on a REAL scripted misdirect agent.
