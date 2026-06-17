# Design Proposal — `skillGraph()`: a declarative, drawable, validated skill router for agentfootprint

**Status:** PROPOSAL. No code is shipped. Gated on an explicit "yes" before any implementation (per working agreement).
**Audience:** agentfootprint library authors.
**Scope:** the declarative `skillGraph()` wrapper + build-time validation + a runtime activation gate. The underlying engine (injections, triggers, `read_skill`, slots, cache, `tree()`) already exists.

---

## 1. Positioning + the market white space

agentfootprint already lets a skill steer an agent: a **skill** is an injection that, when activated, injects a steering **body** into the system prompt AND unlocks its **tools** for the next turn (via `read_skill` / triggers / slots). What is missing is a **declarative way to wire skills into a routed graph** that (a) draws itself, (b) gets time-travel + tracing for free, and (c) is **validated at build time like a type-checker**. Today an author hand-orders regexes (neo's `INTENT_RULES`) and hopes; there is no compile step that catches a dead skill or a mis-wired hop.

`skillGraph()` is that wrapper. Skills become **nodes**; predicate-on-tool-result edges become **transitions**; the whole thing **compiles to a footprintjs flowchart**, so `toMermaid()`, the commit log, `runtimeStageId` tracing, and the lens time-travel scrubber come for free — with **one** small engine change (below), not a parallel engine.

**The validated market white space** (we are NOT building a planner — Semantic Kernel deprecated planners, and the brief agrees):

1. **A drawable `on-tool-return → activate-skill` trigger edge.** Other frameworks route in code you cannot see; here the route is a declared edge that renders.
2. **A unified `defineSkill` = instructions + tools + trigger + sub-procedure → one drawable subflow node.** One declaration, one box on the diagram.
3. **Just-in-time, token-efficient skill loading** — applied not only to skill bodies but to the **routing decision itself**: the model only ever sees the descriptions of the skills it is *allowed* to pick *right now*, never the full catalog.

What we explicitly do NOT build: planner / DAG-generation. The graph is **author-declared**; the LLM only fills the *declared* non-deterministic seams (the entry pick, the fallback pick), and those are **observed in the trace, never baked into the declared graph**.

---

## 2. The model

### 2.1 Skills are nodes — `canStart` (entry) vs transition-only

Each skill is a node. A node carries one routing-relevant flag, named plainly:

- **`canStart: true`** (default) — a valid **cold start**. The entry router may select it. Its description enters the entry-decision catalog.
- **`canStart: false`** — **transition-only**. Reachable ONLY via an incoming predicate edge; excluded from the entry catalog and from the cold-start `read_skill` enum. The motivating case: a *volume-lookup* skill that needs a WWN a prior tool produced — it must never be a cold start, because cold-starting it would be a guaranteed hallucination surface.

`canStart` lives in skill `metadata` (the engine ignores unknown keys) and **drives validation, not runtime arithmetic**: a `canStart:false` skill is simply omitted from the entry catalog and must have ≥1 incoming transition or the build fails.

### 2.2 Predicate transitions — multi-hop edges, NEVER regex

A transition is a **predicate on the last tool's result**:

```ts
{ from: 'A', to: 'B', after: (r) => /* boolean over r */, label?: 'caption' }
```

Critically — and this corrects a framing error shared by earlier drafts — **`r.result` is a `string`, not a structured object.** The shipped `lastToolResult` type is `{ toolName: string; result: string }`. Predicates that want a field must parse:

```ts
{ from: 'vm-triage', to: 'volume-lookup',
  after: (r) => r.toolName === 'get_vm' && JSON.parse(r.result).backingWwn != null }
```

The public predicate signature is therefore exactly `(r: { toolName: string; result: string }) => boolean`. We will **not** type `result` as `unknown`/structured in the API while the runtime hands a string — that would be a leaky abstraction. For ergonomic structured access we add an optional per-skill `parse?: (raw: string) => T` hook in a later phase (v1.1), so `after` can receive a typed object; until then, predicates parse the string and a throw is treated as no-match (§5.4). This is still "reads a structured field, never regex" — the predicate reads a *parsed field of the tool result*, not the raw user text.

### 2.3 The entry router — the consumer's determinism knob

Exactly one decision site picks the **first** skill. The consumer chooses the picker; everything downstream is identical regardless of choice. Plain names (not `read_skill`/`tree`/`hybrid` jargon in the public surface):

| `start.pick` | Mechanism | Determinism | Cost |
|---|---|---|---|
| `'ask-the-model'` | `read_skill` picks from the **entry catalog** | non-deterministic, observed | +1 turn |
| `'match-text'` | regex/predicate over the user message → skill (compiles via `tree()`/`decide()`) | deterministic, pinnable | free, brittle |
| `'score-match'` | **embed** the message, score vs each entry skill's description → **softmax** → argmax / top-k | **reproducible** (pin the embedder; argmax is deterministic) — but NOT a hand-declared rule | cheap (1 embedding), no extra turn |
| `'match-text-then-ask'` (or `…then-score`) | run the rules; on the catch-all default, fall through to `'ask-the-model'` (or `'score-match'`) over the entry set | deterministic when confident, picker otherwise | free unless it falls through |

`'match-text-then-ask'` is the recommended default for real deployments: it converts neo's silent mis-route (regex falls to a catch-all triage skill, no recovery) into an **observed** decision over the entry set.

**`'score-match'` is a *picker*, not a *predicate* — keep them distinct.** A `match-text` rule (and every mid-run `step`) is a **declared boolean** the build can validate + draw **solid**; `score-match` ranks by similarity, so there is **no hand-written condition** to statically check — it is **observed** (drawn dashed, like `ask-the-model`), even though argmax makes it *reproducible* given a fixed embedder. It needs an **embedder** (`embed: (text) => vector`, **pluggable** — the library bundles none) with a **zero-dependency lexical-softmax fallback** when none is supplied. It is the **LLM-free middle ground**: more flexible than regex, cheaper than a model turn, no second model. Critically, **the same LLM-free scorer powers the Why-panel's relevance display** — one scoring mechanism, two uses (it *picks* here; it *explains* there). So `score-match` does not "bring a predicate"; it **replaces** the need for a hand-written predicate at the cost of being observed-not-validated — the deterministic, build-checked edges remain the boolean `step` predicates (§4A.1 D1).

Determinism is **per-decision**: the entry pick is the single non-deterministic step under `ask-the-model`; under `match-text` it is deterministic. Mid-run hops are independently deterministic (a predicate matched) or not (fallback fired) — see §4.8.

---

## 3. The API — concrete sketch + worked example

We keep the **shipped fluent builder** (`skillGraph().entry().route().build()` — neo and the lens depend on it) and add an **object-literal façade** that compiles to the same edges. The object form is required anyway for build-time validation to mean anything (skills must be enumerable independently of edges — see §6.1).

```ts
import { skillGraph, defineSkill } from 'agentfootprint';

const interfaceTriage = defineSkill({
  id: 'interface-triage',
  description: 'Diagnose a reported network interface or port problem.',
  body: 'You are triaging an interface fault. Identify the device and port, then pull counters.',
  tools: [getDeviceTool, getPortCountersTool],
  // canStart defaults to true
});

const vmTriage = defineSkill({
  id: 'vm-triage',
  description: 'Diagnose a VM performance or storage problem.',
  body: 'You are triaging a VM. Identify the VM, then resolve its backing volume.',
  tools: [getVmTool],
});

const volumeLookup = defineSkill({
  id: 'volume-lookup',
  description: 'Look up a storage volume by its backing WWN and report its health.',
  body: 'You have a WWN. Resolve the volume and report capacity, latency, and faults.',
  tools: [getVolumeByWwnTool],
  canStart: false,            // ← transition-only: needs a WWN a prior tool produced
});

const graph = skillGraph({
  skills: [interfaceTriage, vmTriage, volumeLookup],

  start: { pick: 'match-text-then-ask', rules: [
    { matches: /port|interface|link|sfp/i, use: 'interface-triage' },
    { matches: /\bvm\b|virtual machine|datastore/i, use: 'vm-triage' },
  ]},

  steps: [
    // cross-domain hop: VM triage discovers a backing volume → jump to the storage skill
    { from: 'vm-triage', to: 'volume-lookup',
      after: (r) => r.toolName === 'get_vm' && JSON.parse(r.result).backingWwn != null,
      label: 'has backing WWN' },
  ],

  fallback: 'ask-the-model',   // when no step matches → read_skill within the allowed set (§4)
  // fallback: 'strict'         // ← regulated mode: no mid-run model routing (§4.9)
}).build();                     // ← runs build-time validation; THROWS on errors (§6)
```

`build()` returns a footprintjs chart: `graph.toMermaid()` draws it; an `Agent` runs it with full tracing.

---

## 4. THE FALLBACK DESIGN (centerpiece)

> **The single most important finding, stated once.** The engine has **no enforcement seam** between "the model emitted an id" and "the skill activates." `toolCalls.ts:392-397` appends *any* non-empty string to `activatedInjectionIds`; the evaluator's `llm-activated` case then activates any injection with that id. The `read_skill` JSON-schema `enum` is the FULL catalog, built once, and is only a **prompt-level soft hint** the runtime does not enforce. Therefore **the fallback is NOT airtight today, and any claim of "read_skill within the allowed set," "reject out-of-set," "retry cap," or "scoped read_skill" describes code that must be BUILT.** This proposal builds it. Honest statement of v1 scope is in §9.

### 4.1 When the fallback fires — precisely

After a tool returns, the next iteration's evaluator computes the match set of declared transitions out of the **current** skill:

```
M = { t ∈ steps : t.from === currentSkillId  ∧  t.after(lastToolResult) === true }
```

- **`M ≠ ∅`** → a **deterministic** hop (§4.8, §5.2 resolve ties).
- **`M = ∅` and `fallback: 'ask-the-model'`** → the **fallback**: `read_skill` over `allowedSet(currentSkillId)`.
- **`M = ∅` and no fallback (or `fallback: 'strict'`)** → **STAY** (§4.4).

This requires the engine to **know where it is** — `currentSkillId`. That is the keystone engine change (§8).

### 4.2 The allowed set — pinned definition

This is the load-bearing decision, and the earlier drafts disagreed (transitive closure vs direct neighbours). **Pinned, single definition:**

```
allowedSet(s) = ( directSuccessors(s)  ∪  entryNodes ) \ { s }
```

- **`directSuccessors(s)`** — the `to`-targets of `s`'s declared steps. NOT the transitive closure. Transitive closure is wrong: it offers nodes many hops away whose entry preconditions provably are not met (you hold exactly one tool result).
- **`∪ entryNodes`** — the cold-start skills, so a **wrong entry pick is recoverable** (§4.6). This is *why* entry nodes are always in the allowed set.
- **`\ {s}`** — do not re-offer the skill that just dead-ended; deliberate loops are handled by `maxHops` (§5.3), not by accidental self-re-pick.

**On the "but those are the predicates that just failed" objection:** the direct successors are exactly the edges whose predicates returned false. Re-offering them as a menu is acceptable *because the fallback prompt reframes the decision* (§4.3): the model chooses on the tool-result cue and the skill descriptions, not on the failed boolean. Entry nodes give it an escape from the local neighbourhood when none of the successors fit.

The allowed set is **computed at build time per source node** and is a **closed set**. Because the runtime gate (§4.5) enforces it, even a non-compliant model cannot leave the graph.

Configurable per graph and per node when an author genuinely wants a wider net:
`fallback: { allow: 'neighbors+entry' | 'entry' | 'reachable' | (s) => string[] }` (default `'neighbors+entry'`).

### 4.3 How `read_skill` is prompted for the fallback

Reuse `buildReadSkillTool`, but with a **fallback-specialized projection**:

- `inputSchema.id.enum` = `allowedSet(currentSkillId)` ids — the **closed-enum prompt guard**.
- The embedded catalog = **only** those skills' descriptions (token budget = `|allowedSet|`, never the full catalog).
- A **situation header**, because the model chooses on a *tool result*, not the original question:

```
You are inside skill "<currentSkillId>". The tool "<lastToolResult.toolName>" returned a result
that none of this skill's declared transitions handle. Choose the next skill to continue, or emit
a final answer if the result already answers the user.

Tool result (summary): <bounded, redacted summary of lastToolResult.result>
Candidate skills (pick exactly one id):
  - <id>: <description>
  ...
```

The result summary is **bounded** (truncate to N chars) and **redacted** (existing `RedactionPolicy`) so a large/sensitive payload neither blows the budget nor leaks.

### 4.4 The "no sensible fallback / already answered" terminal — STAY, not a fake `done`

When `M = ∅` and there is no fallback (or the model has nothing good to pick): **STAY** in the current skill. The model continues with the current skill's body + tools active; it can call another tool or emit a final answer — the natural ReAct termination.

We **reject** an earlier proposal to add a synthetic `done` member to the `read_skill` enum. `done` is not a real injection id; if it ever reached `toolCalls.ts` it would be appended to `activatedInjectionIds` and the evaluator would find no matching injection — a **silent no-op that looks like an activation in the trace**. "Stop routing" is the *existing* ReAct stop (no tool call → final answer), not a fake skill. Drop `done`.

### 4.5 Rejecting hallucinated / out-of-set ids — THE GATE THAT MUST BE BUILT

Two layers; the second is the one that does not exist yet and is **required for v1** (not deferred):

1. **Schema enum (prevention).** The fallback `read_skill` enum is the allowed set, so a compliant model cannot emit an out-of-set id.
2. **Runtime activation gate (enforcement).** At the activation seam (`toolCalls.ts`, before the blind append), resolve the allowed set from `currentSkillId` and reject:

```ts
if (tc.name === 'read_skill' && !error && !denied) {
  const requestedId = (tc.args as { id?: unknown }).id;
  const allowed = scope.$getAllowedSkillIds?.() ?? ALL_SKILL_IDS; // injected by skillGraph
  if (typeof requestedId === 'string' && allowed.has(requestedId)) {
    /* append to activatedInjectionIds */
  } else {
    scope.$emit('agentfootprint.skill.rejected', { requestedId, allowed: [...allowed] });
    // re-prompt via a synthetic tool_result; do NOT append. currentSkillId unchanged.
  }
}
```

Because we never write an unvalidated id, a hallucinated or out-of-set id **cannot** activate a phantom skill. Rejection is **observed** (`skill.rejected` emit event) and **recoverable** (the model re-picks next iteration). A non-compliant model picking a *real but out-of-scope* skill gets the same rejection + the valid set echoed back.

### 4.6 Wrong entry pick — recoverable mid-run

Three recovery paths, in increasing explicitness:
1. **Self-correction via a predicate edge** — even in the wrong skill, the model calls a tool; the result can fire a declared transition to the right skill. The graph self-corrects without the model "knowing."
2. **Fallback** — the wrong skill's tool produces a result no edge handles → fallback offers `allowedSet` (which includes entry nodes) → the model re-picks a fresh start.
3. **Scoped volunteer-reroute** — base agentfootprint always auto-attaches `read_skill`. Under `skillGraph`, that always-on `read_skill` is **scoped to `allowedSet(currentSkillId)`** (same gate as §4.5), so the model can volunteer a re-route at any turn, but only to a graph-legal skill. Disable with `reroute: 'fallback-only'`.

**The model can re-route mid-run, but never outside the graph. Wrong picks are recoverable; phantom skills are impossible.**

### 4.7 Termination — honest about what guarantees it

Three governors; **be precise about which is load-bearing:**

- **`maxIterations` (existing agent bound) is the REAL termination guarantee.** Each graph hop consumes ≥1 LLM iteration; the iteration cap bounds total hops. Even a non-compliant model emitting the same rejected id every turn terminates — it burns the iteration budget but does not loop forever.
- **`maxHops` (default = `maxIterations`)** and **`fallbackRetryCap` (default 2)** are **observability + early-exit quality-of-life governors**, keyed by the fallback site's `runtimeStageId` in a recorder, reset per `runId` (Convention 4). They are NOT the termination guarantee. Earlier drafts implied the caps guarantee termination — that is backwards.
- **No-progress cycle guard** — if a fallback returns to a `(skill, toolName, resultHash)` triple already visited, stop routing (let the model answer). Kills A→B→A oscillation on the *same* result; loops with *different* results are legal investigations bounded by `maxHops`.

### 4.8 Determinism is per-decision

A hop is deterministic iff a predicate matched. Consequences:
- A `start: 'match-text'` graph (deterministic entry) can still hit a non-deterministic fallback mid-run if a tool returns something undeclared — correct, because you cannot regex a tool result you did not anticipate.
- The full determinism surface is **two orthogonal dials**: `start.pick` (entry) × `fallback` (mid-run).

### 4.9 `fallback: 'strict'` — the regulated/audited mode

`fallback: 'strict'` → no `read_skill` fallback; `M = ∅` immediately STAYs (no model routing mid-run). The graph becomes a **closed deterministic automaton**: declared edges or stop. Combined with `start: 'match-text'`, the entire run is pinnable with zero LLM routing. `fallback: 'ask-the-model'` (default) is the flexible mode.

---

## 4A. The per-hop decision procedure — the grey area

> **Where this slots in.** §4 pins the *fallback* (the `M = ∅ ∧ ask-the-model` seam). This section pins the **rest of the hop**: the precise ordered procedure the engine runs after *every* tool return, the precedence between a declared predicate and a model-volunteered reroute, the four failure modes, and how each branch is drawn and traced. It refines — never contradicts — the load-bearing decisions in §358–366. It is the answer to "what happens on the *ordinary* turn," which is the majority of turns and the part §4 left implicit.

### 4A.0 The reframe: STAY is the default, routing is the exception

The single mental-model correction the rest of this section rests on:

> **The engine never routes because "a result arrived." It routes on exactly two signals: (a) a declared predicate matched, or (b) the model explicitly called `read_skill`. A bare informational result with neither is, by construction, a STAY.**

STAY is **not an edge** and **not a decision the engine arbitrates** — it is the *absence* of a route mutation. `currentSkillId` is unchanged, the existing `tool-calls → loopTo(InjectionEngine)` loop fires (`route.ts:24-26`), and the same skill's body + tools re-inject next iteration. The model reasons over the tool result as **data** and calls another of the *current* skill's tools, or emits a final answer (the natural ReAct stop). Drawing a "STAY edge" would falsify the declared graph; we never do (§4A.6).

This makes "routing is the exception" a **structural** property, not a guideline: in the ordered tree below, STAY is literally the fall-through — the bottom clause reached only when nothing above fired.

> **Reconciliation note (do not re-open).** §4.1 already encodes this: `M = ∅ ∧ strict/none → STAY`. The fallback (`M = ∅ ∧ ask-the-model`) does **not** auto-route — it *asks* the model, which may decline back to STAY (§4.4). There is no "engine auto-fires `read_skill`" path to correct. The only genuine grey-area risk is *over-firing* the fallback, addressed by the §4.7 governors, not by a new auto-route throttle.

### 4A.1 The ordered decision procedure (one hop)

Evaluated strictly top-to-bottom after a tool returns. **First clause that fires wins; lower clauses are not consulted.** This ordering *is* the precedence answer.

```
HOP(currentSkillId = s, lastToolResult = r, iteration = i):

────────────────────────────────────────────────────────────────────────────
G0. TERMINATE-HARD  (governor pre-empt — above all routing)
    if i >= maxIterations:
        → TERMINATE ('final')                                  [route.ts:25, shipped]
    The real termination guarantee (§4.7). An exhausted budget is never
    overridden by a pending route.
────────────────────────────────────────────────────────────────────────────
G1. TERMINATE-NATURAL  (the ReAct stop = STAY's terminal form)
    if the LLM's last response carried ZERO tool calls:
        → TERMINATE ('final'); the LLM's text IS the answer    [route.ts:24-26, shipped]
    No tool ran ⇒ nothing to route on. This is the existing stop, NOT a fake
    `done` (§4.4). Clauses below run only when ≥1 tool actually executed.
────────────────────────────────────────────────────────────────────────────
    ── a tool ran: r = { toolName, result: string } exists ──

D0. GATE any volunteered read_skill  (validity, before precedence)
    if this turn included read_skill(u):                       [toolCalls.ts:~392 gate, NEW]
        if u ∈ allowedSet(s):  mark volunteer = u  (valid, pending)
        else:                  emit skill.rejected {requested:u, allowed:[…]}; drop it
    A turn may legally contain BOTH a domain tool AND read_skill (the registry
    auto-attaches read_skill every turn — buildToolRegistry.ts:104). We gate the
    volunteer for VALIDITY here; we decide PRECEDENCE in D1/D2.

D1. PREDICATE-MATCH-ROUTE  (deterministic — the crisp case; WINS over a volunteer)
    M = { t ∈ steps : t.from === s  ∧  guardedMatch(t.after, r) }
        guardedMatch = t.after wrapped in its OWN try/catch (throw ⇒ false, §5.4);
        from === s is REQUIRED, not advisory (§8.2 — kills cross-skill edge bleed).
    if |M| >= 1:
        chosen = arbitrate(M)                                   [§5.2: priority → first-match]
        currentSkillId ← chosen.to                              (the only mutation)
        if a valid volunteer u was pending:                     ← PREDICATE WINS
            drop u from activatedInjectionIds
            emit skill.reroute.superseded {volunteered:u, won:chosen.to}
        emit skill.routed {from:s, to:chosen.to, by:'predicate', label}
        → ROUTE (deterministic). Next iteration activates chosen.to.

D2. VALIDATED VOLUNTEER-REROUTE  (declared non-det — only if D1 did not fire)
    if a valid volunteer u is pending (and not frozen by §4A.4):
        currentSkillId ← u
        emit skill.routed {from:s, to:u, by:'volunteer', candidates:[…allowedSet(s)]}
        → ROUTE.

D3. read_skill FALLBACK  (declared non-det — M = ∅, no volunteer, a move is needed)
    if fallback == 'ask-the-model' AND NOT routingFrozen(§4A.4):
        offer read_skill SCOPED to allowedSet(s):               [skillTools.ts:118 enum, scoped — NEW]
          inputSchema.id.enum = allowedSet(s).ids               (closed-enum guard)
          catalog = descriptions of allowedSet(s) only          (token budget = |allowedSet|)
          situation header on bounded+redacted r                (§4.3)
        → DEFER-TO-MODEL: the model's read_skill(id) next iteration re-enters at D0.
        The model may instead call a current-skill tool (→ STAY) or answer (→ G1).

D4. STAY-AND-CONTINUE  (the DEFAULT)
    reached when: M = ∅ AND (no valid volunteer) AND (fallback='strict' OR frozen OR allowedSet=∅)
    currentSkillId UNCHANGED (no mutation)
    emit skill.stay {skill:s, reason:'strict' | 'frozen' | 'no-edge-no-volunteer'}
    → STAY: the existing tool-calls → loopTo(InjectionEngine) loop; s re-injects.
```

#### The precedence, stated once

```
maxIterations  >  natural-stop  >  predicate-match  >  validated-volunteer  >  fallback  >  STAY
   (G0)             (G1)             (D1)                (D2)                   (D3)        (D4)
```

The two terminals (G0, G1) sit **above** all routing — you cannot route a run that is already ending. Among live outcomes, **predicate strictly dominates volunteer strictly dominates fallback strictly dominates STAY**.

#### The crux: predicate WINS over a same-hop volunteer (D1 > D2)

The collision is **live, not hypothetical**: `read_skill` is on the menu every turn (`buildToolRegistry.ts:104`), and providers emit parallel multi-tool calls, so a turn `[get_vm(), read_skill(interface-triage)]` is legal — the domain tool's result can fire a predicate `→ volume-lookup` *while* the model volunteered `→ interface-triage`. Both land in the **same** `Evaluate` pass (the volunteer was staged in iteration N's `toolCalls.ts` and arrives via `llm-activated`; the predicate fires on `lastToolResult` — they are simultaneous, not sequenced). There is no "the predicate already won, the model never gets the turn" — that timing claim is false; both are pending at once and the decider must choose.

**It chooses predicate.** Rationale, binding to load-bearing decision #6 ("non-determinism is never baked into the declared graph"): the author declared `{ from: s, to: T, after }` — a *deterministic* intent on this edge. A model guess cannot silently override declared determinism, or the solid edge would become non-deterministic exactly where the author pinned it. The volunteer is **superseded, not discarded silently**: `currentSkillId` goes to the predicate target, the staged volunteer id is dropped from `activatedInjectionIds`, and `skill.reroute.superseded {volunteered, won}` is emitted (drawn as a struck dotted ghost, §4A.6). The model is not punished — next turn it sees it is now in T and re-reasons.

This explicitly **rejects** the "explicit model intent > declared predicate" alternative: it inverts decision #6 and would make any declared cross-domain hop overridable by a model whim. Predicate-wins is the load-bearing call (added as decision #8, §4A.7).

### 4A.2 Arbitration when `|M| ≥ 1` (multi-match)

Unchanged from §5.2, restated for completeness:

```
arbitrate(M):
    if ∃ unique t ∈ M with strictly-max priority:  return t
    else:                                          return first t by declaration order
```

Compiled as **one** `addDeciderFunction` returning **exactly one** branch (never N OR'd triggers — those fire in parallel, the dangerous default). `decide()` evidence records *which field* chose. A same-hop volunteer never enters this contest — D1 resolves entirely within the deterministic layer before D2 is consulted. Silent ambiguity (≥2 same-`from`, no priority) is a **build WARNING** (§6), not a runtime error — first-match is well-defined. Genuine fan-out is opt-in `onMultiMatch: 'parallel'` (v1.1).

### 4A.3 Who decides STAY vs ROUTE — division of labor by *expressibility*

The boundary is structural, not heuristic:

| The next move depends on… | Owner | Mechanism | Determinism |
|---|---|---|---|
| A **field of the result**, expressible as a boolean (`JSON.parse(r.result).backingWwn != null`) | **author**, at build time | a `step` predicate → D1 | deterministic, pinnable, solid edge |
| **Nothing** — the result is data to reason over | **nobody routes** | falls through to D4 STAY | n/a — no decision is made |
| A **semantic judgment** no field captures ("does this error mean I need the storage skill?") | **the model**, at run time | volunteer (D2) or fallback (D3), scoped `read_skill` | declared non-det, observed, dashed edge |

**The rule:** *a predicate fires exactly when the author could write the routing condition as a field test.* If yes, the author declares the edge and D1 owns it deterministically. If no — because the decision needs *interpreting* the result, not testing a field — there is no `step`, `M` is empty, and the model owns it (D2/D3) or STAYs (D4). This is why §6.2 cut `expectField`: `result` is an opaque string, so the semantic seam is *necessarily* the model's; the design's job is to **bound** it (scoped enum + gate) and **observe** it (emits), never to express it as a predicate.

**How the model distinguishes "informational" from "route":** it is never asked "should I route?" as a standing question. It routes only when it *spontaneously volunteers* `read_skill` — the same well-calibrated threshold as "is calling this tool the right move?" STAY is free (call a current-skill tool); routing costs a deliberate, named, scoped `read_skill`. **The asymmetry is the guard** against over-routing (§4A.4). The model's "this is just data, keep working" answer *is* it not calling `read_skill` — silence = STAY.

**There is no "done-in-skill" signal, by design.** "Done with the whole task" → emit a final answer (→ G1). "Done with S, task continues" → volunteer `read_skill(T)`. There is no coherent third state; adding a "done-in-skill" token would recreate exactly the silent-no-op trap §4.4 rejects. The absence of a third option is itself a mis-stay guard — there is no way to "linger" in a finished skill except to keep calling its tools, which the §4A.4 governors catch.

### 4A.4 Failure-mode guards — concrete, and honest about the asymmetry

| Failure mode | What it looks like | Guard | Where it sits |
|---|---|---|---|
| **OVER-routing / thrash** | model volunteers `read_skill` on benign results | **(1) Asymmetric affordance** (§4A.3): STAY is free, routing costs a named scoped call. **(2) `fallbackRetryCap` (default 2)** per fallback site, in a **recorder** keyed by `runtimeStageId`, reset per `runId` (open-Q1: a recorder, NOT shared state — `structuredClone` wipes it across the subflow boundary). On cap → freeze routing (forces STAY). **(3) `reroute: 'fallback-only'`** disables the always-on volunteer entirely. **(4) Predicate-wins (D1>D2)** — a volunteer cannot thrash *against* a declared edge. | D1, D2, §4.7 |
| **OSCILLATION** (A→B→A) | route ping-pongs on the same data | **No-progress cycle guard** (§4.7): a `(skill, toolName, resultHash)` visited-triple set. A route (predicate or volunteer) revisiting a triple **freezes routing** for that triple → STAY + emit `skill.oscillation.frozen`. **Keyed on `resultHash`, not `(A,B)`** — a *legitimate* A→B→A driven by *new* results is legal; only same-result ping-pong freezes. `\{s}` in allowedSet (§4.2) already blocks the trivial self-bounce. | §4.7 |
| **NEVER-routing** (stuck, never volunteers) | predicates too strict, model never volunteers | **No runtime auto-route** (a speculative "you're stuck" auto-route is itself a thrash source). Levers: (1) entry nodes are ALWAYS in allowedSet (§4.2) so a fallback/volunteer can always offer a fresh start; (2) **`maxIterations` (G0) is the hard floor** — a never-routing run terminates with the current skill's answer rather than spinning. Surfaced for the author via the `skill.stalled` emit below. | G0; observability |
| **MIS-STAY** (should have routed, kept grinding) | a route condition existed, no predicate covered it, model didn't volunteer | **The residual risk — no runtime oracle can detect "should have routed" without becoming a thrash source.** Author-side guards: (1) **predicate safety-net** — every *known* cross-domain hand-off should be a declared predicate (the WWN edge is exactly this; VM-triage *will* mis-stay on a backing-WWN result unless the author declares the edge), moving the decision out of the model's hands into D1; (2) **build-time unreachable-skill WARNING + dead-node ERROR** (§6) surface missing wiring before any run; (3) **trace visibility** — every STAY emits `skill.stay`, so a human watching the scrubber sees grinding and adds the edge. | D1 (author); build-time; trace |

**State the asymmetry plainly (do not imply parity):** over-routing and oscillation have **hard runtime guards** (retry cap + visited-triple freeze); never-routing and mis-stay have **no runtime guard** — only `maxIterations` (bounds them) + observability emits + build-time validation. This is *correct*: a false "you should route" signal would itself cause thrash. The system is deliberately **biased toward STAY** and relies on declared edges + bounded volunteering to escape, never on a speculative stuck-detector that auto-routes.

> **`skill.stalled` (observability-only, never auto-routes).** If N consecutive hops STAY in `s` with no predicate fire and `activatedInjectionIds` unchanged, emit `agentfootprint.skill.stalled {skill, hops}`. Computed only on signals **observable at the decision point** — `resultHash` repetition and unchanged `activatedInjectionIds`. We explicitly do **not** define no-progress via "wrote nothing a *downstream* tool consumed": that consumer has not run yet at the hop where the decision is made, so it is uncomputable there and risks breaking a healthy multi-step STAY. `skill.stalled` surfaces mis-stay/never-route to a human; it does not act.

### 4A.5 Partial / multi / no-match-no-need — complete resolution

| Situation | Condition | Resolution |
|---|---|---|
| Crisp match | `|M| = 1` | D1 → the single `.to` |
| Multi-match | `|M| ≥ 2` | D1 + arbitrate (§4A.2); build-WARN if no priority |
| **Partial match** (predicate throws / field absent) | matcher throws or returns false | per-matcher try/catch → that matcher = **false** (§5.4); never suppresses siblings, never crashes. A *throw* is recorded distinctly (below) — a broken predicate must not masquerade as a clean informational STAY |
| No-match, NEED to move | `M = ∅` ∧ fallback ∧ ¬frozen | D3 fallback over allowedSet |
| **No-match, NO need** (informational) | `M = ∅` ∧ (strict ∨ no volunteer) | **D4 STAY** — the default, healthy path. Not a special branch; the *absence* of a fired predicate and the *absence* of a volunteer **is** "no need." The system never asserts "informational"; it simply fails to route and continues |
| No-match, frozen | `M = ∅` ∧ governor froze routing | D4 STAY (routing disabled; let `s` answer) |
| Empty allowed set | `M = ∅` ∧ `allowedSet(s) = ∅` | build-time ERROR (§6); runtime-safe → D4 STAY |

> **The broken-predicate vs informational-STAY distinction (closes a real gap).** §5.4 turns a throwing/absent-field predicate into no-match → STAY — correct for safety, but a *mis-specified* predicate then looks identical to a genuine informational result, and the agent silently grinds the wrong skill. Two requirements: (1) a throw emits a **distinct** `skill.predicate.threw {edge, error}`, **aggregated per run** into a build-validatable warning (not just a per-hop emit buried in a stream), so a predicate throwing on the first real run is loud; (2) the per-matcher try/catch fix is a **v1 requirement, not a note** — confirmed-live: `skillGraph.ts:330` ORs matchers via `matchers.some((m) => m(ctx))` with **no per-matcher guard**, so one matcher's throw kills the entire OR'd rule silently. `evaluator.ts` already guards `rule` throws into `skipped[{reason:'predicate-threw'}]`; the unguarded site is `skillGraph.ts:deriveTrigger`, not `evaluator.ts`.

### 4A.6 Drawing + tracing the grey area

**Drawing** — extends the §7 three-tier grammar with the STAY and superseded representations it lacks:

| Hop outcome | Static (declared) graph | Runtime (traced) overlay |
|---|---|---|
| D1 predicate-route | **solid** arrow `s → T`, labeled | solid arrow **lit** + the `decide()` field that fired |
| D2 volunteer-reroute | **dashed** arrow (the `◇read_skill` glyph) | dashed arrow **lit** + *"model chose T from {allowedSet}"* |
| D3 fallback | **dotted** arrow → `◇read_skill` → dotted to each allowed target | dotted **lit** (distinct from D2 so "no rule covered it" reads differently from "model chose to leave") |
| **D4 STAY** | **no edge** | a **runtime-only self-loop tick** on `s` with a count badge *"stayed ×N"* — reuses the lens `onLoop` self-loop primitive; never pollutes the static graph |
| Superseded volunteer (D1 won) | n/a | **struck dotted ghost** `s ⤏ u` + *"superseded by predicate → T"* |
| Oscillation-frozen | n/a | dashed arrow with a **🔒 freeze marker** + *"frozen: same-result ping-pong"* |
| Rejected (out-of-set, D0) | n/a | **dashed red stub** returning to `s` + *"out of allowed set"* |
| Terminal (G0/G1) | n/a | edge to the `final` leaf (the ReAct stop) |

The **STAY self-arc is runtime-only**: the static `toMermaid()` shows *possible* routes (solid predicate edges + entry picks); the overlay adds STAY/dashed/dotted/badge from the trace. This honors decision #6 — non-determinism is always dashed/dotted, never in the solid declared graph.

**Tracing** — each hop emits exactly one structured `RouteDecision` record carrying `runtimeStageId` (the universal trace key — correlates with the commit log, `InOutRecorder`, and the lens scrubber with zero new infrastructure). A `RouteDecisionRecorder` owns a `SequenceStore<RouteDecision>` (Convention 1):

```
RouteDecision {
  runtimeStageId, currentSkillId,
  lastToolResult: { toolName, summary },          // bounded + redacted (§4.3)
  outcome: 'predicate'|'volunteer'|'fallback'|'stay'|'superseded'|'frozen'|'rejected'|'terminal',
  chosen?, evidence?,                              // 'predicate' → which decide() field fired
  allowedSet?,                                     // volunteer/fallback → the menu shown
  guards?: { stuckCount?, rerouteCount?, oscillationTriple? },
  why: string,                                     // templated, human-readable
}
```

Templated `why` lines (one per hop in the Think view) make the **invisible STAY as auditable as a route**:

- predicate — *"`vm-triage` ran `get_vm`; step 'has backing WWN' matched (backingWwn=0x500…) → `volume-lookup`. [deterministic]"*
- stay — *"`vm-triage` ran `get_port_counters`; no step matched, no reroute; stayed (call #2). [default stay]"*
- volunteer — *"`vm-triage` ran `get_vm`; no step matched; model chose `interface-triage` from {volume-lookup, interface-triage, vm-triage}. [model reroute]"*
- superseded — *"model volunteered `interface-triage`, but step 'has backing WWN' fired → `volume-lookup` won; volunteer discarded. [predicate > volunteer]"*
- frozen — *"alternation `vm-triage`⇄`interface-triage` on the same `get_vm` result; routing frozen. [oscillation guard]"*

### 4A.7 Engine-free vs minimal new work

**Free today (the procedure's skeleton already composes):** the per-hop loop is the existing `loopTo(InjectionEngine)`; STAY = the existing `tool-calls` ReAct loop with `currentSkillId` unmutated; terminal = the existing zero-tool-call `final` (`route.ts:24-26`); `lastToolResult`, `activatedInjectionIds`, `maxIterations`, `decide()` evidence, the lens `kind:'model'`→dashed convention, the `onLoop` self-loop primitive — all shipped.

**New (beyond the §8 keystone — no new loop, subflow, or termination mechanism):**
1. **`from`-gating + per-matcher try/catch** in `skillGraph.ts:deriveTrigger` (≈ line 300–330) — gate each matcher on `ctx.currentSkillId === edge.fromId` AND wrap each in its own try/catch. **(Correct file is `skillGraph.ts:330`, the `matchers.some(...)` site — NOT `evaluator.ts`, which already uses a guarded `for…of`.)** Requires the keystone (`currentSkillId` on `InjectionContext`, threaded into the matcher closures).
2. **The per-hop decider** — one compiler-emitted `addDeciderFunction` per multi-`from` group computing `M` → exactly one branch (§4A.2).
3. **The runtime activation gate** at `toolCalls.ts:~392` (§4.5, D0) — reject ids ∉ `allowedSet(currentSkillId)` + `skill.rejected`. (The `enum` itself already exists at `skillTools.ts:118` as the *full* catalog — only **scoping** it per-decision is new, not the enum mechanism.)
4. **The `fallbackRetryCap` / oscillation-triple state** in a recorder keyed by `runtimeStageId`, reset per `runId` (NOT shared state — `structuredClone` boundary).
5. **Trace/draw plumbing** — the `RouteDecisionRecorder` + `skill.stay` / `skill.reroute.superseded` / `skill.predicate.threw` / `skill.stalled` emits + the STAY self-arc and struck-ghost styles.

### 4A.8 Determinism boundary (what is pinnable)

| Branch | Pinnable? | Test surface |
|---|---|---|
| G0 maxIterations / G1 natural-stop | ✅ exact | counter / `toolCalls.length === 0` (shipped) |
| **D1 predicate-route + arbitration** | ✅ exact, per-decision | `routeForResult(currentSkill, toolResult) → nextSkill` pin-table (exhaustive, exit-1 on mismatch). **Contingent on `from`-gating (§8.2)** — without `currentSkillId` the input is meaningless |
| D0 gate accept/reject | ✅ exact | `allowedSet(s).has(u)` is pure given the set |
| D1>D2 supersede, oscillation-freeze, frozen-STAY | ✅ exact | deterministic given `M`, the pending volunteer, and the visited-triple set |
| **D2 volunteer pick / D3 fallback pick** | ❌ statistical | fixed-seed mock over N phrasings, pick-rate ≥ threshold. The **scope (enum = allowedSet) and the gate are pinnable**; only *which* allowed id the model names is not |

**The boundary, once:** everything that *selects among declared structure* — predicate match, arbitration, gate accept/reject, supersede, freeze, both terminals — is deterministic and pinnable. Only the model's *free pick within the closed enum* (D2, D3) is non-deterministic, and even there the enum scope and gate are pinnable; only the named id is statistical. Non-determinism lives solely in the two `read_skill` seams and is always drawn dashed/dotted.

### 4A.9 Added load-bearing decisions (the grey area)

These extend §358–366; they refine, none contradict:

- **#8 — Predicate beats a same-hop volunteer (D1 > D2).** A fired declared predicate supersedes a model-volunteered `read_skill` on the same hop; the volunteer is dropped from `activatedInjectionIds` and emitted as `skill.reroute.superseded`. Rationale: keeps the declared graph deterministic-where-declared (decision #6). The "explicit model intent wins" alternative is **rejected** — it inverts #6. The collision is live (`read_skill` on the menu every turn, parallel multi-tool calls); the "predicate already won by timing" claim is false (both arrive in the same `Evaluate` pass) — precedence is decided *structurally* in the decider, not by timing.
- **#9 — STAY is the default, routing is the exception.** The engine routes only on (a) a matched predicate or (b) an explicit `read_skill`. Silence = STAY. STAY is a *state* (no mutation, no edge), drawn only as a runtime self-arc.
- **#10 — Over-route/oscillation have runtime guards; never-route/mis-stay have only observability.** The asymmetry is deliberate — a speculative "you should route" signal is itself a thrash source. `maxIterations` bounds the un-guarded modes; `skill.stalled` + build-time validation surface them.
- **#11 — A broken predicate must not masquerade as an informational STAY.** A predicate throw emits a distinct `skill.predicate.threw`, aggregated per run into a loud warning; the per-matcher try/catch at `skillGraph.ts:330` is a v1 requirement.

---

**This section refines the existing `skillGraph()` proposal — it does not replace it.** It pins the per-hop grey area the body left implicit and stays fully consistent with §358–366. Like the rest of the doc, it is a **proposal only**, gated on an explicit "yes" before any implementation.
```

---

I've

---

## 5. Traversal semantics

### 5.1 The walk (one run)

```
ITER 1:  start.pick(userMessage) → activate entry skill(s)   [single non-det step under 'ask-the-model']
LOOP per iteration:
  activate(currentSkillId)        → inject body + unlock tools (slots, unchanged)
  LLM picks WHICH tool to call    → tool executes → lastToolResult set
  ROUTE(currentSkillId, lastToolResult):
    M = steps where from===currentSkillId AND after(lastToolResult)
    if |M| >= 1   → resolve (§5.2) → currentSkillId = chosen.to        [DETERMINISTIC]
    elif fallback → read_skill within allowedSet(currentSkillId)       [DECLARED non-det]
    else          → STAY (LLM continues in currentSkillId)
  hops++ ; if hops > maxHops → freeze routing, let current skill answer (§4.7)
TERMINATE: LLM emits final answer, OR maxIterations reached, OR $break.
```

### 5.2 Multiple transitions match the same result

`priority` (if distinct) → else **first-match by declaration order**. **Important compilation note** (corrects an earlier draft): first-match-wins is NOT expressible as the current per-target OR'd triggers — independent triggers for B and C would BOTH fire (silent parallel activation, the dangerous default). When ≥2 steps share a `from`, the compiler emits a **single footprintjs `addDeciderFunction`** that returns exactly one branch (`decide()` evidence capture records which field chose). This requires `currentSkillId` to know which `from` you are at — another reason the keystone is mandatory. Silent ambiguity (≥2 same-`from` edges, no priority) is a **build warning**. Genuine multi-domain fan-out is **opt-in** `onMultiMatch: 'parallel'` → a selector fork with `failFast`.

### 5.3 Cycles & max-hops

Cycles are **legal** (real investigations revisit skills). Termination per §4.7. The build emits an **info** note when a cycle (non-trivial SCC) exists, so the author confirms `maxHops` is sane.

### 5.4 Predicate throws / absent field

Each matcher is wrapped **individually** in try/catch → no-match (NOT the whole OR'd rule). This corrects a real shipped flaw: today `deriveTrigger` ORs all matchers into one `.some()`, so one edge's throw suppresses *every* edge sharing the target. Fix: `matchers.some((m) => { try { return m(ctx); } catch { return false; } })`. A predicate reading `JSON.parse(r.result).wwn` when the field is absent (or the result is not JSON) becomes no-match → routing falls to the next edge / fallback / STAY. Never crashes the run.

---

## 6. Build-time validation (the differentiator)

`build()` runs static checks and returns `{ errors, warnings, info }`. **Errors throw; warnings/info log.** This is a "type-checker for routing." Only checks the data model can actually support are included — we **do not advertise vaporware.**

| Check | Severity | Condition |
|---|---|---|
| Edge to missing skill | **ERROR** | `step.to` / `step.from` / `rule.use` references an id not in `skills` |
| Dead transition-only node | **ERROR** | `canStart:false` AND in-degree (incoming steps) = 0 |
| Fallback to empty allowed set | **ERROR** | `allowedSet(s) = ∅` (no successors, no entry nodes) |
| Unreachable skill | **WARNING** | no path from any entry via declared edges, and not read-skill-by-intent |
| Ambiguous transition | **WARNING** | ≥2 same-`from` predicate edges with no `priority` |
| Cycle present | **INFO** | non-trivial SCC over declared edges |

### 6.1 Why the object-literal API is REQUIRED for validation

The shipped fluent builder `remember()`s a skill *from the edge call itself*, so a skill the author forgot to wire simply does not exist in the graph — "zero incoming edges" is undetectable for an orphan. The dead-node and missing-target checks are therefore **only meaningful when skills are enumerated independently** via `skills: [...]` in the object façade. **Ship the object API and the validation together** or the checks are vacuous. Missing-target validation likewise only applies to the string-id steps of the object API (the fluent API passes objects, so the target always exists).

### 6.2 What we CUT from v1 (do not fake it)

- **The "expectField ∉ produces(source-tools)" routing type-checker.** Marketed earlier as the headline, it is **unbuildable today**: there is no tool-output schema; `result` is an opaque string; nothing is annotated with `produces`. The check would be always-skipped, i.e. vaporware. **Cut entirely from v1.** Revisit only if/when tools gain output schemas.

---

## 7. Compilation to a footprintjs flowchart

The agent is already a footprintjs chart: an injection-engine subflow runs Gather→Evaluate→Route→Delta each iteration. `skillGraph` compiles **into that structure** — no parallel engine.

| Element | Compiles to | Drawn as |
|---|---|---|
| Skill (with sub-procedure body) | slot injection / `addSubFlowChart` mount | labeled box (subflow node) |
| Predicate / on-tool-return step | `addDeciderFunction` branch (`decide()` evidence) | **solid arrow** (deterministic) |
| `start: 'match-text'` | decider chain (via `tree()`) | **solid arrows** from START |
| `start: 'ask-the-model'` | scoped `read_skill` over entry nodes | START ◇ + **dashed arrows** to entry nodes |
| Fallback | selector running `read_skill(allowedSet)` | **dashed arrow → `◇ read_skill`** → dashed arrows to allowed targets |
| Latent model reach (volunteer-reroute) | annotation only | **dotted faint arrow** |

**Three-tier visual grammar:** solid = deterministic (the declared graph); dashed = declared non-determinism (entry-read_skill / fallback ◇); dotted = latent escape hatch. This **reuses the shipped lens convention** — `skillGraph.ts` already emits `kind: 'model'` and the lens renders `model → -.->` dashed. New work is incremental: a `◇read_skill` glyph and carrying the picker type on the entry edge so it draws dashed. **Non-determinism is drawn distinctly and never baked into routing.**

**Observed, not baked.** Every entry pick, fallback pick, and rejection fires `agentfootprint.skill.routed` / `skill.rejected` (extending the existing `metadata.skillGraph` provenance + `context.evaluated` event). The Think view shows the run's *actual* path: *"`vm-triage` ran `get_vm` → no declared step matched → model chose `volume-lookup` from {volume-lookup, interface-triage, vm-triage}."* The declared graph is deterministic-where-declared; the observed trace shows where the LLM actually chose.

---

## 8. Mapping to the real internals — reused vs new

**Reused (zero engine change):** `Injection`; all 4 trigger kinds; `evaluateInjections`; the Gather→Evaluate→Route→Delta subflow; slots; `read_skill` auto-attach; `skillScopedTools`; `lastToolResult`; the parallel selector fork (`failFast`); `decide()` evidence; `toMermaid`; the `SkillGraphFlow` lens; `metadata.skillGraph` provenance + `context.evaluated`.

**The ONE keystone engine change (mandatory): `currentSkillId` as first-class graph-machine state on `InjectionContext`.** The engine must track *which skill node the graph is currently in* and expose it. Without it: no allowed set, no `from`-gating, no first-match decider, no pinnable test. Everything in this proposal derives from it.

> **Correction (verified against source, 2026-06-17).** An earlier draft said this is *"already computed as `activatedIds[last]` in `buildToolsSlot.ts:103-110`."* **That is wrong for route-driven graphs — the entire `skillGraph()` use case.** `activatedInjectionIds` is the **`read_skill` / `llm-activated` subset only** (populated solely at `toolCalls.ts:397`; the lone "current skill" derivation — `updateSkillHistory`, `CacheGateDecider.ts:173-174` — reads its tail and its own comment confirms "`read_skill` APPENDS each newly-activated skill"). A skill activated by a **route trigger** (`rule` / `on-tool-return`) lands in the evaluator's `activeInjections` (`evaluator.ts:30-81`) and **never** in `activatedInjectionIds`. Deriving `currentSkillId` from that source leaves it `undefined` for every predicate-routed hop → `from`-gating never fires.
>
> So `currentSkillId` is **not a value to surface — it is state to introduce:**
> - the **entry router** SETS it (the first skill chosen);
> - a **route transition** (a predicate edge firing) UPDATES it to the `to` node;
> - it is threaded onto `InjectionContext` so `deriveTrigger`'s matchers gate on `ctx.currentSkillId === edge.fromId`.
> - It is single-valued (one current node), **not** re-derived from the active-injection *set* each iteration — that set can hold several skills (an `always` base skill + the routed skill) with no within-iteration recency to pick "the current node" from.
>
> A small but genuine state-machine addition, not a one-line promotion.
>
> **Deeper finding (statelessness → the cursor must be sticky).** `evaluateInjections` is **stateless per iteration** — a `rule`/`on-tool-return` skill is active *only* while its trigger matches *this* step. A `.route(...)` edge reads the *previous* step's `lastToolResult`, so a routed skill activates for **one** iteration, then goes dark the moment the next tool returns something else. A real state machine ("you're *in* B until an edge leaves B") therefore needs the cursor to be **sticky**: once the graph enters B, B stays active until a `from`-gated edge moves the cursor off it. (`tree` mode is already effectively sticky — its leaf predicates read stable `ctx` fields, not `lastToolResult` — so this concerns flat `.route(...)` edges only.)
>
> **The clean, single-source-of-truth shape (what v2 builds):** one pure function on the graph —
> `nextSkill(ctx) → skillId` — first from-gated route whose predicate matches `ctx.lastToolResult` (declaration order), else the current cursor (sticky stay); when the cursor is unset it returns the cold-start entry. Each candidate predicate runs in its own try/catch (a throw = no-match, dev-warned). Both consumers derive from it, so trigger ↔ cursor can never diverge:
> - each route-target B's compiled trigger is simply `nextSkill(ctx) === B`. That one expression IS from-gating (the edge only fires while the cursor is on its source) AND stickiness (cursor on B with no exit edge → `nextSkill` returns B) AND a clean handoff (the step a `B→C` edge fires, `nextSkill` returns C, so B deactivates the same step C activates — no double-active overlap);
> - the loop's cursor-update stage sets `currentSkillId = nextSkill(ctx)` each iteration.
> `entry` (`always`/`rule`) triggers are UNCHANGED — an `always`-entry stays a persistent base; `currentSkillId` tracks the latest *transitioned-into* skill, orthogonal to a base. So the change is **non-breaking for entry skills** and tightens only route-target activation (which v1 admits was never `from`-enforced). `nextSkill` is exactly the design's `routeForResult` pin-table target (§9).

> ## ✅ IMPLEMENTATION STATUS (2026-06-17) — the keystone SHIPPED; the rest is still proposed
> **Shipped in this increment** (panel-reviewed, verdict *SHIP WITH NITS*; full suite 3073 green + per-reactMode real-loop e2e tests):
> - `currentSkillId` on `InjectionContext` + `AgentState` (the keystone), reset per turn at seed.
> - the pure `graph.nextSkill(ctx)` resolver + each route target compiling to `nextSkill(ctx) === id` (`from`-gating + sticky + clean handoff + per-matcher try/catch) in `skillGraph.ts`.
> - the Injection-Engine Evaluate stage advancing the cursor with the same ctx, threaded through the flat (`buildAgentChart`) AND grouped (`buildDynamicAgentChart` + `sf-llm-call`) mount mappers, plumbed via `Agent`/`AgentBuilder.skillGraph()`.
>
> **NOT in this increment (still 🔶 proposed, gated):** the runtime activation gate at `toolCalls.ts` (item 3 below — no `allowedSet` enforcement ships yet), the per-decision scoped `read_skill` enum (item 4), the object-literal façade + the 6 build-time validation checks, the `'score-match'` entry strategy, the grey-area governors, and the `RouteDecisionRecorder`. So the "Reused (zero engine change)" framing below describes only the v1 baseline — the keystone DID add the small engine change enumerated above. The §9 "v1 ships the gate too" line is aspirational, not what shipped here.

**New runtime work (small, required for an airtight fallback):**
1. `currentSkillId` on `InjectionContext` (keystone).
2. **Stateful `from`-gating** in `deriveTrigger`: each matcher gated on `ctx.currentSkillId === edge.fromId` AND wrapped in its own try/catch. (Today `from` is informational and matchers are OR'd unguarded — so an edge `A→B on get_wwn` ALSO fires while in skill D producing the same result. This cross-skill edge bleed makes the *deterministic* graph unsound independent of the fallback.)
3. **Runtime activation gate** at `toolCalls.ts:392` (§4.5) — reject ids ∉ `allowedSet(currentSkillId)`, emit `skill.rejected`. (Today: blind append of any string.)
4. **Per-decision scoped `read_skill` enum** — `buildReadSkillTool(allowedSet)` rebuilt per decision, not the full catalog once (`skillTools.ts:84-130`).

**Build-time only (no engine):** the object façade + the 6 validation checks + the determinism drawing grammar.

**NOT built:** planner / DAG-generation; the expectField type-checker (§6.2); structured-field predicate typing (`result` stays `string`; `parse` hook deferred to v1.1).

---

## 9. Honest v1 scope, open questions, phased plan

### What v1 must NOT claim until the gate ships
The fallback "within the allowed set" is a **guarantee only after items 1–4 of §8 ship.** If v1 ships the façade + validation but not the runtime gate, the docs MUST say: *"fallback reaches the full catalog; predicates receive a string result."* We will not type `result` as structured nor claim scoped fallback while `toolCalls.ts` blind-appends.

### Open questions
1. **Where does the `fallbackRetryCap` counter live?** Proposed: a recorder keyed by the fallback site's `runtimeStageId`, reset on `runId` change — NOT shared state (which is `structuredClone`d across the subflow boundary). Confirm before building.
2. **`reroute` default** — should the scoped volunteer-reroute be on (`'allowed'`) or off (`'fallback-only'`) by default? Lean **on** (matches base agentfootprint's always-on `read_skill`, now graph-bounded).
3. **`parse` hook** — per-skill vs per-tool? Defer the decision to v1.1 with a real adopter.

### Phased build plan
- **v1 (façade + validation + the gate, shipped together):**
  (a) object-literal `skillGraph({ skills, start, steps, fallback })` + `defineSkill({ canStart, parse? })`;
  (b) the keystone `currentSkillId` + stateful per-matcher `from`-gating;
  (c) the runtime activation gate + per-decision scoped `read_skill` enum;
  (d) the 6 build-time checks (object API);
  (e) STAY terminal; `fallback: 'strict'` mode;
  (f) the three-tier drawing grammar;
  (g) tests: a pure `routeForResult(currentSkill, toolResult) → nextSkill` pin-table (exhaustive, exit-1 on mismatch — extends neo's `routeForQuestion`); a fixed-seed mock harness for entry/fallback `read_skill` picks asserting accuracy ≥ threshold; one unit per validation check. (Per Convention 2, examples are mandatory integration tests.)
- **v1.1:** per-skill `parse` hook for typed predicates; `onMultiMatch: 'parallel'`.
- **Deferred:** expectField routing type-checker (needs tool output schemas).

### Testing split (pin deterministic, statistically check the model)
- **Deterministic (pinned, exact):** `match-text` entries; every predicate step via `routeForResult`; all validation errors/warnings as unit cases. Contingent on `from`-gating (§8.2) — without it the pin-table input `currentSkill` is meaningless.
- **Non-deterministic (statistical):** entry/fallback `read_skill` picks against a fixed-seed mock provider over N phrasings, asserting pick-rate ≥ threshold (not exact equality). Optional real-cheap-model accuracy gate off the hot path.

---

## The load-bearing decisions, restated

- **`allowedSet(s) = (directSuccessors(s) ∪ entryNodes) \ {s}`** — direct, not transitive; closed; build-time-computed; runtime-enforced. Keeps the model inside the graph.
- **STAY is the terminal, not a fake `done`** — no synthetic enum member that the engine would silently no-op.
- **`maxIterations` guarantees termination; `maxHops`/retry-cap are quality-of-life** — honest about which is load-bearing.
- **`currentSkillId` is the keystone** — allowed set, `from`-gating, first-match arbitration, and pinnable testing ALL derive from it. The deterministic graph is unsound without it (cross-skill edge bleed), independent of the fallback.
- **The fallback is NOT airtight until the runtime gate at `toolCalls.ts:392` is built** — the enum is a soft prompt hint; the runtime appends any string. This proposal builds the gate; v1 does not claim scoped fallback before it ships.
- **Non-determinism is per-decision and always observed as a dashed/dotted edge** — never baked into the declared graph.
- **The expectField type-checker is cut** — unbuildable on today's data model; we do not advertise it.

---

**Gate:** This is a proposal only. No code will be written until an explicit "yes" for these specific changes.
