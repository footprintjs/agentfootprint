# Time-travel scrub stops — Boundaries vs. domain-declared Milestones

Status: **IMPLEMENTED, 2026-06-05** (browser-verified). The shipped approach is the
domain **classifier** `conventions.milestoneFor(id)` consumed by the lens
`cursorPositionsAtDrill` from the commit log — NOT the emit-channel seam this memo
originally proposed. Rationale: no hot-path emit, the lens already had the commit list
in `cursorPositionsAtDrill`, and the agentfootprint-lens is agent-aware so importing the
classifier is clean. Milestone kinds shipped: iteration · slot · llm-turn · tool-call ·
decision. Boundaries still drive the drill hierarchy (incl. multi-agent nesting), as the
memo recommends. The rest of this memo is retained for rationale.
Author: design review, 2026-06-05.

Read in conjunction with:
- `agentfootprint/docs/design/boundary-commit-ranges.md` — the boundary/commit-range substrate this builds on
- `agentfootprint-lens/src/core/group/cursorPositionsAtDrill.ts` — the current scrub-stop rule (the thing this memo proposes to change)
- `footprintjs` emit channel + `agentfootprint-lens` EmitRecorder pattern — the proposed implementation seam
- Lens v0.1 ONE-CURSOR architecture (locked) — must be preserved

---

## 1. The question

Today the Lens time-travel slider stops on **structural boundaries** (subflows +
compositions). Is that the right design, or should "what counts as a meaningful
scrub stop" be a **domain-declared** concept (a *Milestone*) — basically a
labelled collection of commits the domain team decides on?

This memo recommends the **Milestone** direction, *additively*, and lays out the
API, the multi-agent requirement, naming, migration, and tests for sign-off.

---

## 2. How it works today (verified from source)

- `BoundaryRecorder` (agentfootprint) opens/closes a `CommitRangeIndex` range per
  **subflow.entry/exit**, **composition.start/end**, and **run.entry/exit**.
- The Lens `buildGroups(boundaryIndex)` turns those ranges into `Group`s.
- `cursorPositionsAtDrill(groups, …)` produces the slider stops with the LOCKED
  v0.1 rule: **"one slider stop per chart box"** — NOT one per commit. At drill
  depth 0 the stops are the top-level groups; drilling re-keys to sub-groups.

### Two smells

1. **Granularity is coupled to chart structure.** A stage earns a scrub stop
   only by being a *subflow*. So to make "the LLM turn" a stop you must set
   `reactStructure:'subflow'`; ToolCalls / Route / a plain CallLLM never get a
   stop. An **observability** decision is forced through a **structural** lever.
   (Verified live: top-level stops were `injection-engine → cache → thinking`;
   CallLLM, Route, ToolCalls had no stop; slots were hidden at top level.)

2. **Domain policy lives in the generic renderer.** `cursorPositionsAtDrill`
   hardcodes `isHiddenAtTopLevel` (slot-specific) and `emitsEndPosition`
   (Parallel/Loop). Those are agentfootprint semantics inside the domain-agnostic
   Lens. The Lens shouldn't know what a "slot" is.

Neither is *wrong* for v0.1 — but "what's a meaningful step" is a **domain**
question being answered in the **wrong layer** through a **structural proxy**.

---

## 3. The multi-agent requirement (must-have)

In supervisor / multi-agent flows the top level is a set of **agents** (and
sub-agents). The user must be able to **drill into an agent** to see *its*
topology (its ReAct loop) in explainable-ui. So the design has to support a
**nested drill hierarchy**: `supervisor → agent → sub-agent → that agent's loop`,
with meaningful scrub stops *at every level*:

- Top level (supervisor): stops = each agent invocation / each supervisor routing
  decision.
- Drill into an agent: stops = that agent's iterations / LLM turn / tool call /
  decision.

This is the clinching argument for separating **drill hierarchy** (structural)
from **scrub stops** (semantic): the hierarchy is naturally the agent/sub-agent
nesting; the stops at each level are domain milestones scoped to that level.

---

## 4. Two models

### Model A — keep boundary-grouping (status quo)
Granularity = structure. Lens keeps the hardcoded product rule.
- ➕ zero authoring; falls out of the chart.
- ➖ hero stages (CallLLM / ToolCalls / Route) can't be stops without
  restructuring; domain policy stuck in the Lens; granularity not author-controlled.

### Model B — domain-declared Milestones (recommended)
The domain (agentfootprint) declares the meaningful stops; the Lens renders them.
- ➕ decouples granularity from structure; moves policy to the domain that owns
  the meaning; reusable for non-agent domains; solves the user's exact pain;
  composes with the existing emit→Lens pattern (no new footprintjs primitive).
- ➖ a new concept to design/test/document; needs good defaults so it stays
  zero-config; must not fork the timeline.

---

## 5. Recommended design — Milestones, additive

**Keep boundaries for the DRILL HIERARCHY** (a subflow/agent genuinely is a box
you zoom into — including the multi-agent nesting). **Add domain-declared
Milestones as the SCRUB STOPS** at each drill level. Delete the domain product
rules from `cursorPositionsAtDrill`; replace them with "iterate the milestones
scoped to the current group."

### 5.1 What a Milestone is
A **Milestone** = a labelled, ordered, domain-meaningful scrub point, anchored to
a commit and scoped to an enclosing group. Proposed shape (domain-facing):

```
Milestone {
  runtimeStageId   // the cursor value (footprintjs address space) — ONE cursor preserved
  commitIdx        // anchor for jumpTo / cross-tab sync
  groupId          // enclosing drill group (which level it shows at)
  kind             // domain enum: 'iteration' | 'llm-turn' | 'tool-call' | 'decision' | 'agent-step' | ...
  label            // human text ("LLM turn 2", "called get_weather", "routed: tool-calls")
}
```

### 5.2 Implementation seam — reuse the emit channel
agentfootprint emits a typed `agentfootprint.milestone` event at each meaningful
moment (this is the established [[telemetry through emit]] pattern — milestones
are telemetry, not state). A Lens-owned EmitRecorder accumulates them; the slider
iterates milestones scoped to the current drill group. **No new footprintjs core
primitive** — substrate (commits, boundaries, emit) already exists.

### 5.3 Defaults (zero-config)
agentfootprint ships default milestones so it "just works" without authoring:
- `iteration` — once per ReAct iteration
- `llm-turn` — at CallLLM
- `tool-call` — per tool execution
- `decision` — at Route
- `agent-step` — per sub-agent invocation (multi-agent)
- the updated slot(s) — especially meaningful in `reactMode:'classic'`, where
  only Messages re-runs after turn 1 (the slider would show Messages lighting up
  alone — the teaching payoff).
Consumers can add/override milestones for their own domains.

### 5.4 One cursor, commit-anchored (non-negotiable)
Milestones are a richer **set of valid stop positions** for the SAME cursor
(`runtimeStageId`, anchored to `commitIdx`). NOT a second timeline. The locked
one-cursor architecture is preserved; commentary, chart highlight, Trace tab all
keep syncing on the one cursor.

---

## 6. Naming

Do **NOT** call it "Checkpoint" — `FlowchartCheckpoint` already means the
pause/resume serialized run state in footprintjs. Reusing the word would muddy a
load-bearing term. Proposed: **Milestone** (alternatives: Waypoint, Marker). The
Lens commentary already says "moments" — align the vocabulary (a Milestone
surfaces as a "moment").

---

## 7. Migration (additive, low-risk)

1. agentfootprint emits default milestones (emit channel) — additive, no behavior
   change to runs.
2. Lens adds a `MilestoneRecorder` (EmitRecorder) + `cursorPositionsAtDrill` reads
   milestones scoped to the current group instead of the hardcoded box rule.
3. Boundaries STILL drive the drill hierarchy (and the multi-agent nesting) —
   unchanged.
4. Remove `isHiddenAtTopLevel` / `emitsEndPosition` domain rules from the Lens
   (now expressed as which milestones the domain emits).
5. Back-compat: if no milestones are present, fall back to today's
   boundary-derived stops (so non-agent / un-instrumented charts still scrub).

---

## 8. Test plan (7 patterns)

- **Unit** — milestone emit shape; scoping to enclosing group; commit anchor.
- **Functional** — a dynamic run produces iteration/llm/tool/decision milestones
  in order; slider stops match.
- **Integration** — drill into an agent → milestones re-scope to that agent's
  loop; multi-agent supervisor → agents at top, sub-agent milestones on drill.
- **Property** — one cursor invariant: every milestone's `runtimeStageId` resolves
  to a real commit; cursor monotonic with slider.
- **Security** — milestone payloads honor redaction (emit `RedactionPolicy`).
- **Performance** — milestone accumulation O(1) per event; slider build within
  budget at N milestones.
- **Load** — large multi-agent run (many agents × iterations) stays responsive.

---

## 9. Open questions for the domain team

1. Granularity default: is "iteration + llm-turn + tool-call + decision" the right
   default set, or too noisy? (Could default to iteration-level, opt into finer.)
2. Should the *updated slot* be a milestone in dynamic mode (all slots change) or
   only in classic mode (only Messages changes)? Leaning: classic — that's where
   it teaches.
3. Naming: Milestone vs Waypoint vs Marker — and do we surface it as "moment" in
   the UI to match commentary?
4. Does footprintjs want a thin generic "milestone" helper, or does it stay 100%
   an agentfootprint emit convention? Leaning: agentfootprint-only (keep
   footprintjs minimal; compose, don't duplicate).

---

## 10. Recommendation

Adopt **Model B (Milestones)**, additively: boundaries keep the drill hierarchy
(incl. multi-agent nesting); domain-declared milestones (via emit, defaulted,
commit-anchored, one cursor) become the scrub stops. This fixes the layering smell,
gives the author control over granularity, directly enables the per-stage walk the
user wants, and serves multi-agent drill-down — without a new footprintjs primitive
and without forking the timeline.
