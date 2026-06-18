# Skill-graph builder — full guide (for adopters + their coding agents)

A complete, copy-pasteable reference to the declarative **skill-graph routing** in
agentfootprint. Written so a coding agent can build with it without inventing APIs.
Current as of **`agentfootprint@6.35.0`**. Companion reference: [`skill-graph-spec.md`](./design/skill-graph-spec.md).
Runnable demos in the package: `examples/features/15-skill-graph.ts`,
`23-skill-graph-scoped-read-skill.ts`, `24-skill-graph-entry-relevance.ts`.

## 1. Mental model

A skill graph is a small **state machine**. Each **skill is a node** (a steering
`body` + its own gated `tools`); **edges are routing**. Only the active skill's body
+ tools load, so it's token-efficient, and `graph.toMermaid()` draws itself. The
engine tracks **which skill it's currently in** (a sticky cursor), so routing rules
only fire from the right place.

## 2. Define skills

```ts
import { defineSkill } from 'agentfootprint';

const triage = defineSkill({
  id: 'triage',
  description: 'Start: triage the request',   // shown to the LLM + used by entryByRelevance
  body: 'Figure out what the user needs and route.',
  tools: [],                                   // optional: unlocked only while this skill is active
});
```

Every `defineSkill` is **`read_skill`-activatable by default** (the agent
auto-attaches a `read_skill` tool when ≥1 skill is registered) — the model's escape
hatch.

## 3. Build a graph + wire it to an agent

```ts
import { skillGraph, decide, Agent } from 'agentfootprint';

const graph = skillGraph()
  .entry(triage)                                            // where a turn starts
  .route(triage, billing, { onToolReturn: 'get_invoice' }) // a transition
  .build();

Agent.create({ provider, model }).skillGraph(graph).build();
graph.toMermaid();   // draws the topology (declared === drawn)
```

`graph.build()` returns `{ skills, edges, nodes, toMermaid(), nextSkill(ctx),
reachableSkills(cur?), scoreEntries?(ctx) }`. Always pass the **whole** `build()`
result to `.skillGraph(...)`.

## 4. Pick how a turn ENTERS — four strategies

```ts
// (a) regex / predicate — deterministic, pinnable, brittle. `when` gets the full InjectionContext.
skillGraph().entry(triage, { when: (ctx) => /refund|invoice/.test(ctx.userMessage) })

// (b) decision tree — intent routing, exactly one leaf fires
skillGraph().tree(
  decide((c) => /billing|payment/.test(c.userMessage), billing,
  decide((c) => /down|error|outage/.test(c.userMessage), incident, triage, 'incident?'),
  'billing?')
)

// (c) read_skill — the MODEL picks. NOT a method: it's the default. Declare no
//     deterministic entry and the LLM calls read_skill('<id>') on turn 1.

// (d) entryByRelevance — pick by MEANING (6.35.0). Embeds the message + each entry's
//     description, cosine → softmax → best match. LLM-free, reproducible. Entries
//     become EXCLUSIVE (only the picked one loads). Needs an embedder.
import { mockEmbedder } from 'agentfootprint';   // swap for a real embedder in prod
skillGraph().entry(triage).entry(billing).entry(incident).entryByRelevance(mockEmbedder())
```

An embedder is `{ dimensions: number; embed({ text, signal? }): Promise<number[]> }`.
After a turn the ranking is on `agent.getLastSnapshot()?.sharedState.entryScores`
→ `[{ id, cosine, relevance }]` (`relevance` is a 0..1 softmax share — the "Why this
skill?" %).

## 5. Transitions on a TOOL RESULT (the from-gating keystone)

```ts
const graph = skillGraph()
  .entry(esxiInventory)
  // when get_vm_disks returns a WWN, hop into volume-lookup:
  .route(esxiInventory, volumeLookup, {
    when: (r) => r.toolName === 'get_vm_disks' && !!JSON.parse(r.result).wwn, // r = { toolName, result }
    label: 'has WWN',
  })
  // sugar: .route(esxiInventory, volumeLookup, { onToolReturn: 'get_vm_disks' })
  .build();
```

**Route edges are `from`-gated:** `A → B` fires **only while the cursor is on A**. You
stay in a skill until an edge takes you out (sticky), and the hand-off is clean (the
old skill switches off the same step the new one switches on). `.route(...)`'s `when`
receives the **tool result** `{ toolName, result }` (a string) — *not* the full context.

## 6. Scoped `read_skill` (the gate, 6.35.0)

`read_skill('id')` is **rejected** unless `id` is reachable from the current cursor —
so the model can't jump out of the graph. The allowed set is
`graph.reachableSkills(currentSkillId)` = the cursor's direct successors ∪ the entry
skills, minus the cursor (a decision `tree()` returns all leaves — `read_skill` stays
a full escape hatch there). On an out-of-set call the model gets a re-prompt naming
the allowed skills, the cursor stays put, and an `agentfootprint.skill.rejected`
event fires. **Agents with no skill graph are unaffected** (the gate is off).

## 7. Observe the routing

- `agentfootprint.context.evaluated` (per iteration) → `payload.activeIds` + `payload.routing` (which edge/decision activated each).
- `agentfootprint.skill.rejected` → `{ requestedId, currentSkillId, allowed, iteration }`.
- `scope.entryScores` (snapshot) → the relevance ranking.
- `graph.toMermaid()` → the diagram. Renders in **agentThinkingUI** (rack + "Why this tool?" panel) — live: https://footprintjs.github.io/agentThinkingUI/

```ts
const rec = { id: 'cap', onEmit: (e) => { if (e.name === 'agentfootprint.skill.rejected') console.log(e.payload); } };
Agent.create({ provider, model }).skillGraph(graph).recorder(rec).build();
// NOTE: a raw recorder's onEmit event uses `e.name` (+ `e.payload`), not `e.type`.
```

## 8. Validate, observe, nudge (6.36.0)

**Build-time check-up** — catch wiring mistakes before you run.
```ts
const result = graph.checkup();   // { ok, problems: [{ kind:'error'|'warning', code, message, skill? }] }
//   codes: unknown-skill (error), no-entry (error), unreachable-skill, ambiguous-routes, self-loop (warnings)
skillGraph().entry(a).route(a, b, { onToolReturn: 'x' }).build({ check: 'throw' }); // throw on error
//   check: 'warn' (default — dev-mode console) | 'throw' | 'off'
```

**Object-literal form** — list skills *separately* from the wiring, so the check-up can flag a listed-but-unwired skill.
```ts
const graph = skillGraph({
  skills: [triage, billing, volumeLookup],
  start:  'triage',                                  // | { use } | { rules:[{when,use}] } | { entries:[...], byRelevance: embedder }
  steps:  [{ from: 'triage', to: 'billing', onToolReturn: 'get_invoice', label: 'invoice' }],
  check:  'throw',                                   // default 'throw' for the object form
});
```

**`routeRecorder()`** (`agentfootprint/observe`) — record the path the run actually took.
```ts
import { routeRecorder } from 'agentfootprint/observe';
const routes = routeRecorder();                       // { pingPongWindow?, maxRejectedRetries? }
Agent.create({ provider, model }).skillGraph(graph).recorder(routes).build();
// after a run:
routes.getPath();        // ['triage','billing']  — the skill sequence
routes.getHops();        // per-hop: { fromSkill, toSkill, outcome:'entry'|'route'|'stay'|'rejected', why, edgeLabel, lastTool }
routes.getRejections();  // out-of-reach read_skill attempts
routes.getTrips();       // governor trips: oscillation (A→B→A→B) + a run of rejected jumps
```

**`defineRelevanceHint()`** — an advisory note when `entryByRelevance`'s top entries are a near-tie.
```ts
import { defineRelevanceHint } from 'agentfootprint';
Agent.create({ provider, model }).skillGraph(graph).instruction(defineRelevanceHint({ threshold: 0.15 })).build();
// at turn start, IF the top two entry skills are within `threshold`, drops a NON-binding note into the
// system prompt ("a keyword scorer ranked these close — use your judgment"). A hint, never an order.
```

## 9. Honest status (so your agent doesn't invent APIs)

**✅ Shipped + usable (6.36.0):** `defineSkill`; `skillGraph()` fluent **and** object-literal
forms with `.entry` / `.route` / `.tree` / `.entryByRelevance` / `.build({check})`; tool-result
`from`-gated routing; scoped `read_skill` + `skill.rejected`; `toMermaid()`; `read_skill` as the
model-picks entry/fallback; `graph.nextSkill` / `graph.reachableSkills` / `graph.scoreEntries` /
`graph.checkup`; `routeRecorder()` (path + governor trips); `defineRelevanceHint()`.

**🔶 NOT built yet — don't call these:** a runtime governor *force-stop* (today `getTrips()` only
*labels* a spinning run; the iteration cap is the hard stop), `cursorBefore`/`cursorAfter` fields on
`context.evaluated`, and the agentThinkingUI **Description Doctor** (the description-diff view).
