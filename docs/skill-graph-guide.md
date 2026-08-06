# Skill-graph builder — full guide (for adopters + their coding agents)

A complete, copy-pasteable reference to the declarative **skill-graph routing** in
agentfootprint. Written so a coding agent can build with it without inventing APIs.
Current as of **`agentfootprint@8.5.0`**. Companion reference: [`skill-graph-spec.md`](./design/skill-graph-spec.md).

**Every snippet below has a runnable, tested counterpart** under `examples/features/` (they run in the
`test:examples` suite, so they can't silently drift from the API): `15-skill-graph.ts` (basics),
`23-skill-graph-scoped-read-skill.ts`, `24-skill-graph-entry-relevance.ts`, `25-skill-graph-checkup.ts`,
`26-skill-graph-route-recorder.ts`, `27-skill-graph-relevance-hint.ts`,
`42-skill-graph-model-pick.ts`, `43-skill-graph-tree-pick.ts`,
`44-skill-graph-read-skill-offer.ts`. Run any with
`npx tsx examples/features/<file>` — and prefer reading those (they carry a "why" header) over trusting
the prose here if the two ever disagree.

## 1. Mental model

A skill graph is a small **state machine**. Each **skill is a node** (a steering
`body` + its own gated `tools`); **edges are routing**. Only the active skill's body
+ tools load, so it's token-efficient, and `graph.toMermaid()` draws itself. The
engine tracks **which skill it's currently in** (a sticky cursor), so routing rules
only fire from the right place.

## 2. Define skills

```ts
import { defineSkill } from 'agentfootprint/context';

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

> **`viaToolName` is refused since 8.7.0.** It read as a promise — name a tool and that
> tool activates the skill — and no such tool was ever built. Nothing read the field;
> a skill declaring `viaToolName: 'open_playbook'` activated through `read_skill` like
> every other skill. Mounting one now throws and names the fix. The option is removed
> in 9.0.0.

### Skills authored as FILES — `skillsFromDir`

Keep bodies where prose belongs: in files, next to the code they describe, reviewable
in a diff. The loader reads a directory of `SKILL.md` files and hands each to
`defineSkill` — it is a loader, not a second mechanism.

```ts
import { skillsFromDir, skillGraph } from 'agentfootprint/context';

// skills/billing/SKILL.md
// ---
// name: billing
// description: Use for refunds, charges and billing questions.
// ---
// When handling billing: confirm identity first, then …

const loaded = await skillsFromDir('./skills');   // sorted by name, so a chart is stable
const graph = skillGraph({
  skills: loaded,
  start: 'billing',
  steps: [{ from: 'billing', to: 'refund', onToolReturn: 'get_invoice' }],
  check: 'throw',
});
Agent.create({ provider, model }).skillGraph(graph).build();
```

**What it can and cannot carry.** The frontmatter grammar is deliberately small —
`name` and `description`, and everything after the closing `---` is the body. That is
the whole per-file surface:

| In a `SKILL.md` | Not in a `SKILL.md` |
|---|---|
| `name` → the skill id (`/^[a-zA-Z0-9_-]{1,64}$/`) | `tools` — a tool is code, and a markdown file cannot carry an `execute` |
| `description` → the only thing the model reads before opening it | `autoActivate` — so a loaded skill never scopes the tool list on its own |
| the body, after the closing `---` | `surfaceMode` per file — `skillsFromDir(dir, { surfaceMode })` applies to ALL of them, or none |
| extra frontmatter keys (ignored, so a file stays portable) | `cache`, `refreshPolicy` — `defineSkill` defaults apply |

So a loaded skill is body-only. To give one tools, wire the loaded skill into a graph
and put the tools on the *route target* you define in code — or define that skill with
`defineSkill` instead and mix the two lists (`[...loaded, codeAuthoredSkill]`). Layout:
`dir/<skill>/SKILL.md` (preferred — the folder can hold the skill's other assets) or
`dir/SKILL.md` (the directory IS one skill); both can be mixed. Node-only, local paths
only — a URL is refused by name, because "these files are mine" is a claim you can only
make about your own disk at build time. Two files claiming one `name` is refused naming
both files.
→ runnable + tested: **`examples/features/47-skills-from-dir-graph.ts`**.

## 3. Build a graph + wire it to an agent

```ts
import { Agent } from 'agentfootprint';
import { skillGraph, decideSkill } from 'agentfootprint/context';

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

## 4. Pick how a turn ENTERS — five strategies

```ts
// (a) regex / predicate — deterministic, pinnable, brittle. `when` gets the full InjectionContext.
skillGraph().entry(triage, { when: (ctx) => /refund|invoice/.test(ctx.userMessage) })

// (b) decision tree — intent routing, exactly one leaf fires
skillGraph().tree(
  decideSkill((c) => /billing|payment/.test(c.userMessage), billing,
  decideSkill((c) => /down|error|outage/.test(c.userMessage), incident, triage, 'incident?'),
  'billing?')
)

// (c) read_skill (bare) — the MODEL picks, no method. Declare ONE entry as a base;
//     extra skills with no incoming edge are read_skill-reachable, and the LLM jumps
//     to them ad-hoc. (For a clean exclusive entry menu, prefer (e).)

// (d) entryByRelevance — pick by MEANING (6.35.0). Embeds the message + each entry's
//     description, cosine → softmax → best match. LLM-free, reproducible. Entries
//     become EXCLUSIVE (only the picked one loads). Needs an embedder.
import { mockEmbedder } from 'agentfootprint/memory';   // swap for a real embedder in prod
skillGraph().entry(triage).entry(billing).entry(incident).entryByRelevance(mockEmbedder())

// (e) entryByRead — the agent's OWN LLM reads the menu and picks (6.38.0). Like (d),
//     entries are EXCLUSIVE (only the pick loads) — but NO embedder and NO extra model
//     call: on turn 1 no entry body loads, the agent is offered the entries via
//     read_skill, and its choice becomes the cursor. Use when you have no embedder, or
//     embeddings route poorly for your domain's language. Mutually exclusive with (d).
skillGraph().entry(billing).entry(incident).entryByRead()
```

> **(d) vs (e):** both make entries exclusive and token-efficient. `entryByRelevance`
> ranks the menu with an **embedder** (reproducible, off the hot loop). `entryByRead`
> lets the **agent's LLM** pick by reading descriptions (no embedder, routes on real
> intent). Object form: `{ start: { entries } }` → entryByRead; add `byRelevance: embedder`
> → entryByRelevance. See [example 28](../examples/features/28-skill-graph-entry-read.ts).

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

## 6. Scoped `read_skill` — the gate, and the move (6.35.0 · honoured since 8.3.0)

`read_skill('id')` is **rejected** unless `id` is reachable from the current cursor —
so the model can't move the graph somewhere the graph doesn't go. (A skill the graph
never wires at all is a separate question: see *Skills the graph doesn't route*
below.) The allowed set is
`graph.reachableSkills(currentSkillId)` = the cursor's direct successors ∪ the entry
skills, minus the cursor. On an out-of-set call the model gets a re-prompt naming
the allowed skills, the cursor stays put, and an `agentfootprint.skill.rejected`
event fires. **Agents with no skill graph are unaffected** (the gate is off).

**`read_skill` offers what the gate will grant (8.5.0).** The tool's description is
rebuilt each iteration from the same reachability the gate enforces, so the menu and
the verdict cannot disagree:

```text
Reachable from here:
  - volume-lookup: Resolve a volume by WWN
  - escalation: How to page the on-call engineer

Not reachable from here (read_skill for these will be refused):
  - capacity-report: Report free capacity per volume
```

The **enum stays the full catalog** on purpose. Tool-argument validation runs *before*
the gate, so a narrowed enum would turn every out-of-reach pick into a generic schema
error — silently retiring the gate's teaching refusal, the `skill.rejected` event,
`routeRecorder`'s rejection hops and the rejected-cap governor's only input. Under
`reactMode: 'classic'` the tools slot is cached after turn 1, so the menu stays the
full catalog there (a cursor-scoped menu would freeze at the turn-1 cursor); dev mode
warns when that applies.

**A decision `tree()` cannot be jumped at all (8.5.0).** `reachableSkills()` is empty
for a tree, and a leaf pick is refused with a message that explains why:

```text
read_skill("capacity") cannot move a decision tree. A tree routes by predicate on
every iteration — it has no cursor to jump, so this skill would not activate even
though the tool accepted the name. Answer with the skill the tree routed to, or finish.
```

> **Fixed in 8.5.0.** Before, tree mode reported *all* the leaves as reachable, so the
> gate accepted a leaf pick and `read_skill` answered *"activated for the next
> iteration"* — and nothing happened: a leaf compiles to a `rule` trigger, a
> `read_skill` call writes only `activatedInjectionIds`, and no rule trigger reads
> that. The run then emitted `reroute_superseded` naming a winner that did not exist,
> because tree mode never writes a cursor at all. Honouring the pick instead would
> have broken three of the tree's own rules — exactly one leaf per iteration, leaf-
> scoped tools, and declared === drawn — so the gate refuses. The escape hatch under
> a tree is the **open** skills (anything registered beside the graph), which really
> do activate by `read_skill`.

→ runnable + tested: **`examples/features/43-skill-graph-tree-pick.ts`** (a refused
leaf pick and an accepted open skill in one run) and
**`examples/features/44-skill-graph-read-skill-offer.ts`** (the menu tracking the
cursor hop by hop).

**A pick the gate ACCEPTS moves the cursor** — the same cursor a declared edge
moves. So the skill loads on the next iteration: body, tools, and the graph's own
`steps` out of it. What the gate allows and what actually takes effect are the same
set, which is the whole point of having a gate.

> **Fixed in 8.3.0.** Before, an accepted pick only appended the id to
> `activatedInjectionIds` — which nothing but a bare `llm-activated` skill reads. So
> `read_skill` answered *"Skill 'x' activated for the next iteration"* and, for a
> rules-form entry, an exclusive entry or a route target, nothing happened. A
> `start: { rules }` graph whose rules missed the user's phrasing could never load a
> skill at all: no tools, on any iteration, forever.

Precedence, when both want the cursor on the same turn (the model can emit a domain
tool and `read_skill` in one message):

```
a declared edge that fired   >   the model's pick   >   stay where you are
```

The author's declared route always wins — a model guess never overrides
determinism the author pinned. The pick is not silently dropped, though: the run
emits `agentfootprint.skill.reroute_superseded` with what was picked and what won,
so the answered "activated" claim is never left quietly unmet.

```ts
agent.on('agentfootprint.skill.reroute_superseded', (e) =>
  console.log(e.payload), // { volunteeredId, wonId, fromSkillId, iteration }
);
```
→ runnable + tested: **`examples/features/42-skill-graph-model-pick.ts`**.

### Skills the graph doesn't route (8.4.0)

The gate bounds where the **cursor** can go. It does not own your whole skill
catalog. A skill the graph never **wires** — no entry, no `steps` edge, no tree leaf
— is **open**: `read_skill` may reach it from any cursor, it activates like any
`read_skill` activation, and it does **not** move the cursor.

```ts
Agent.create({ provider, model })
  .skillGraph(graph)          // routing: bounded, cursor-gated, drawn
  .skill(escalationPolicy)    // open: reference material, reachable from anywhere
  .selfExplain()              // open: the debug skill, reachable from anywhere
  .build();
```

Two conditions, both required, and both there for a reason:

- the skill's trigger is `llm-activated` (the default from `defineSkill`) — that is
  the trigger `read_skill` actually activates, so admitting a rule-gated injection
  would just be a different lie;
- the graph declares no incoming edge to it — a **bare model edge** `.route(a, m)` is
  a declared, drawn affordance ("from `a`, the model may hop to `m`"), so `m` stays
  reachable only from `a`.

> **Fixed in 8.4.0.** Before, everything outside the graph's reachable set was
> rejected — including `.selfExplain()`'s own debug skill, any `.skill()` registered
> beside the graph, and a skill listed in `skills[]` and wired to nothing (whose
> check-up warning says *"it can only be reached by the model via read_skill"*). All
> three were offered to the model in `read_skill`'s menu and refused on every call,
> so their bodies could never load. Worth naming plainly: if you registered unrelated
> skills beside a graph expecting the graph to hide them, they are now reachable by
> name. The cursor still cannot leave the graph, and nothing routes from them.

→ runnable + tested: **`examples/features/23-skill-graph-scoped-read-skill.ts`**.

## 6b. What the graph refuses (8.4.0)

A check-up reports; these are past reporting. Each of the following used to compile
and then silently discard half of what you declared — so each is now an error whose
message names the fix:

| declaration | what used to happen |
|---|---|
| `.tree()` + `.entry()`/`.route()` | the tree won; every entry and route was dropped |
| `skillGraph({ tree, start })` / `{ tree, steps }` | same, in the config form — and a **type error** now, too |
| a skill in `skills[]` that is not a tree leaf | compiled out of the graph entirely — never reached the agent |
| two different skills with one id | last write won (first, under a tree); the loser vanished |
| a second `.skillGraph()` on one agent | the routing was replaced; graph 1's skills stayed registered with dead wiring |

→ runnable: **`examples/features/25-skill-graph-checkup.ts`**.

## 7. Observe the routing

- `agentfootprint.context.evaluated` (per iteration) → `payload.activeIds` + `payload.routing` (which edge/decision activated each).
- `agentfootprint.skill.rejected` → `{ requestedId, currentSkillId, allowed, iteration }`.
- `agentfootprint.skill.reroute_superseded` → `{ volunteeredId, wonId, fromSkillId, iteration }` — an accepted `read_skill` pick a declared edge outranked on the same turn.
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
import { formatCheckup } from 'agentfootprint/context';

const result = graph.checkup();   // { ok, problems: [{ kind:'error'|'warning', code, message, skill? }] }
if (!result.ok) throw new Error(formatCheckup(result));   // 8.7.0 — the library's own formatter
//   ERRORS (fail `ok`, and `.build()`):
//     unknown-skill   — an edge/entry names a skill that is not in skills[]
//     no-entry        — nothing can start a turn
//   WARNINGS (never fail a build — a graph the model can still navigate is not broken):
//     unreachable-skill   — no deterministic edge reaches it. Since 8.7.0 the message is told
//                           per TRIGGER KIND, so it is true for a hand-authored trigger too.
//     model-edge-only     — 8.7.0. The only way in is a BARE `.route(a, b)`, which compiles to
//                           no trigger: the model must read_skill it, and only from `a`.
//     multi-entry-fanout  — 8.7.0. ≥2 entries and no way to choose between them, so every
//                           matching entry loads while only ONE can be the cursor.
//     dead-entry-step     — 8.7.0. An entry declared after an unconditional one can never be
//                           the cold-start cursor, so the routes out of it never fire from there.
//     ambiguous-routes, self-loop
//   contract codes (6.39.0): body-foreign-tool, body-unknown-tool (warnings) — see below
skillGraph().entry(a).route(a, b, { onToolReturn: 'x' }).build({ check: 'throw' }); // throw on error
//   check: 'throw' (DEFAULT since 8.7.0 — matches the object form) | 'warn' (dev console, never
//          throws) | 'off'
```

**Baseline tools the graph cannot see (8.7.0).** A graph knows only the tools its own skills
carry, so a body that says `lookup_order(id)` — a tool you registered with `.tool()` on the
agent — used to be reported as naming a tool that exists nowhere. Tell it:
```ts
graph.checkup({ knownTools: ['lookup_order'] });                 // or
skillGraph().entry(a).build({ knownTools: ['lookup_order'] });   // same field at build time
```
A `knownTools` name is neither `body-unknown-tool` (it exists) nor `body-foreign-tool` (it is
not somebody else's) — it is callable from every skill, which is the whole point.

**The cursor is PER RUN (8.7.0 — documented, always true).** `graph.nextSkill(ctx)` and
`InjectionContext.currentSkillId` describe where the graph is *inside one `agent.run()`*. A
second `run()` on the same agent starts cold again, at the entry, whatever the first run
ended on — the graph is a per-turn state machine, not conversation memory. If a turn needs to
resume where the last one stopped, carry the id yourself (persist it and start the next turn's
graph with `start: { rules: [...] }` keyed on it) rather than expecting the cursor to survive.

**Body ↔ tool-contract check (6.39.0)** — `checkup()` also runs a deterministic, no-LLM
pass over each skill's `body` vs the tools it unlocks (proposal 009 Tier 1). It catches
the "the model refuses a tool that's right there / is told about one it can't call" class:
```ts
//   body-foreign-tool  — the body names a tool that belongs to ANOTHER skill (not callable
//                        here; usually an intentional read_skill handoff — confirm it).
//   body-unknown-tool  — the body has a `tool_name(` call to a tool that exists NOWHERE
//                        (a typo or a renamed/removed tool).
import { checkSkillContract } from 'agentfootprint/context';
checkSkillContract(skill, knownToolNames?);   // check ONE skill standalone (outside a graph)
```
Both are WARNINGS — they never fail `.build()`. (The *semantic* contradiction Tier 1 can't
see — a body calling an OPTIONAL arg "required" — is Tier 2, LLM-advisory, not yet built.)
→ runnable + tested: **`examples/features/29-skill-contract-check.ts`**.

**Agent ↔ tool-server contract (6.40.0)** — if your tools call a remote tool-server (an
MCP-ish sidecar) that publishes a catalog (`GET /tools`), diff your schemas against it:
```ts
import { toolContractCheckup } from 'agentfootprint';
const catalog = await (await fetch(`${base}/tools`)).json();      // [{ name, inputSchema }]
const { ok, problems } = toolContractCheckup(myTools, catalog);   // required-divergence (error),
//   optional-drift / arg-divergence / missing-on-server / dead-endpoint — catch "tool 404s /
//   omits a required arg / ignores my filter" at build/CI time. → example 30.
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
→ runnable + tested: **`examples/features/25-skill-graph-checkup.ts`** (check-up + object form).

**`routeRecorder()`** (`agentfootprint/observe`) — record the path the run actually took.
```ts
import { routeRecorder } from 'agentfootprint/observe';
const routes = routeRecorder();                       // { pingPongWindow?, maxRejectedRetries? }
Agent.create({ provider, model }).skillGraph(graph).recorder(routes).build();
// after a run:
routes.getPath();        // ['triage','billing']  — the skill sequence
routes.getHops();        // per-hop: { fromSkill, toSkill, outcome, why, edgeLabel, lastTool }
                         // outcome: 'entry'|'route'|'model-pick'|'stay'|'rejected'
routes.getRejections();  // out-of-reach read_skill attempts
routes.getTrips();       // governor trips: oscillation (A→B→A→B) + a run of rejected jumps
```

**`'model-pick'` is new in 8.5.0**, and it is a *type widening* — an exhaustive
`switch` over `RouteOutcome` now needs the extra case. A hop the model drove with
`read_skill` used to be recorded as a `'route'` wearing the caption of whatever
declared edge happened to point at the same skill, so the trace asserted that edge
had fired when it had not. The cause now comes from the graph's own cursor resolver
(`context.evaluated`'s new `cursorMove.by`), and a `'model-pick'` hop deliberately
carries **no** `edgeLabel`.

**`maxRejectedRetries` can actually trip now (8.5.0).** The counter used to reset on
every iteration's evaluation — and an evaluation fires between every pair of
rejections — so it never passed 1 and the governor was unreachable outside a parallel
tool batch. It now resets only when the cursor really **moves**, which is exactly the
case a model stuck re-asking never reaches, and each run of rejections trips once
rather than once per iteration past the cap.
→ runnable + tested: **`examples/features/26-skill-graph-route-recorder.ts`** (path + governor trips).

**`defineRelevanceHint()`** — an advisory note when `entryByRelevance`'s top entries are a near-tie.
```ts
import { defineRelevanceHint } from 'agentfootprint/context';
Agent.create({ provider, model }).skillGraph(graph).instruction(defineRelevanceHint({ threshold: 0.15 })).build();
// at turn start, IF the top two entry skills are within `threshold`, drops a NON-binding note into the
// system prompt ("a keyword scorer ranked these close — use your judgment"). A hint, never an order.
```
→ runnable + tested: **`examples/features/27-skill-graph-relevance-hint.ts`**.

## 9. Honest status (so your agent doesn't invent APIs)

**✅ Shipped + usable (8.3.0):** `defineSkill`; `skillGraph()` fluent **and** object-literal
forms with `.entry` / `.route` / `.tree` / `.entryByRelevance` / `.entryByRead` / `.build({check})`;
tool-result `from`-gated routing; scoped `read_skill` + `skill.rejected`; `toMermaid()`; `read_skill`
as the model-picks entry/fallback — **the pick moves the cursor and the skill really loads
(8.3.0; before that it was accepted, reported, and ignored)**, with `skill.reroute_superseded`
when a declared edge outranks it; `graph.nextSkill` / `graph.reachableSkills` /
`graph.scoreEntries` / `graph.checkup`; `routeRecorder()` (path + governor trips);
`defineRelevanceHint()`.

**🔶 NOT built yet — don't call these:** a runtime governor *force-stop* (today `getTrips()` only
*labels* a spinning run; the iteration cap is the hard stop), `cursorBefore`/`cursorAfter` fields on
`context.evaluated`, and the agentThinkingUI **Description Doctor** (the description-diff view).
