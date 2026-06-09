# Proposal: `skillGraph()` — the token-efficient, *visualizable* skill graph

**Status:** v1 · proposed (NO implementation yet — this is the north star, gated)
**Affects:** `agentfootprint/src/lib/injection-engine/` (new `skillGraph` builder + a graph extractor; the trigger primitives already exist), `agentfootprint-lens` (render the declared graph), `agentfootprint/observe` (a structure recorder for the graph). Optional v2 engine touch: scoped `read_skill`.
**Estimated change (v1):** ~200 LOC of *sugar + extraction* over existing primitives — **zero engine change** for deterministic edges + drawing. Scoped model-routing deferred to v2.

---

## One-liner / positioning

> **A visualizable skill-dependency graph that loads skills just-in-time — cheaper tokens, sharper reasoning, and you can *see* why each skill activated.**

Three properties together, which **no surveyed framework ships as a set**: (1) declared = drawn, (2) just-in-time *token-efficient* skill loading, (3) a first-class **`on-tool-return → activate-skill`** edge.

---

## What this solves

A naive agent puts **all skills + all tools** in the system prompt every turn → high token cost **and** worse reliability (the model wades through dozens of irrelevant tools). agentfootprint already avoids this with **dynamic ReAct** (slot × trigger × cache re-engineers context per turn, loading only what's active). But today that routing is **imperative and invisible**: a consumer wires triggers by hand, and there's no declared graph to *draw* or reason about.

`skillGraph()` makes the dynamic-loading topology **declarative and drawable**: the consumer declares *"when `get_interface_counters` returns CRC > 0 → load the `sfp-diagnostics` skill,"* and that single line is **the routing rule, the token-saving loader, and the picture.**

This also gives **near-1:1 parity with LangGraph** (declared nodes + conditional edges), so LangGraph-origin agents (e.g. the Neo / Infra_Mon migration) port mechanically.

---

## Market evidence (2026-06 scan, 12+ frameworks)

The market splits cleanly:

- **Model-routed** (OpenAI Agents SDK / Swarm handoffs, AutoGen Swarm, Bedrock Agents, classic ReAct): the LLM picks the next step. Flexible, but the graph is **latent** — not declared, hard to draw or test.
- **Code-routed / drawable** (LangGraph `add_conditional_edges`, Haystack `ConditionalRouter`, Mastra `.branch`, Inngest AgentKit deterministic state-router, Google ADK `Sequential/Parallel/Loop`, CrewAI Flows `@router`, MS Agent Framework): a code predicate on **state** decides the next node; the graph is declared and renderable.

footprintjs sits firmly in the **code-routed** camp — the right side for a visualizable skill graph. Two takeaways:

1. **Deterministic predicate-edge routing is table-stakes** (validated, but me-too). decider ≈ LangGraph conditional edges / Haystack `ConditionalRouter`; selector ≈ ADK `ParallelAgent`; subflow ≈ LangGraph subgraph.
2. **White space (no surveyed framework occupies it):**
   - a **drawable `on-tool-return → activate-skill`** edge — everyone routes on accumulated *state*; the "tool X returned value Y" event is invisible in their graphs (LangGraph's `tools_condition` is closest and is coarse: "any tool call → tools node").
   - a unified **skill = instructions + tools + trigger + sub-procedure**, compiling to **one drawable node**. Market analogs are scattered/weak (SK plugins, Bedrock action groups, sub-agents).
   - **Don't build** planner/DAG generation — Semantic Kernel *deprecated* its planners; the market moved to function-calling.

Sources: LangGraph [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) · [add_conditional_edges](https://reference.langchain.com/python/langgraph/graph/state/StateGraph/add_conditional_edges); OpenAI Agents SDK [Handoffs](https://openai.github.io/openai-agents-python/handoffs/) · [Visualization](https://openai.github.io/openai-agents-python/visualization/); AutoGen [Swarm](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/swarm.html); Semantic Kernel [Future of Planners](https://devblogs.microsoft.com/semantic-kernel/the-future-of-planners-in-semantic-kernel/); Google ADK [Workflow agents](https://adk.dev/agents/workflow-agents/); Bedrock [How it works](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-how.html); Haystack [ConditionalRouter](https://docs.haystack.deepset.ai/docs/conditionalrouter); CrewAI [Flows](https://docs.crewai.com/en/concepts/flows); Mastra [Control flow](https://mastra.ai/docs/workflows/control-flow); Inngest AgentKit [Deterministic routing](https://agentkit.inngest.com/advanced-patterns/routing); Pydantic AI [Toolsets](https://ai.pydantic.dev/toolsets/).

---

## The mechanism already exists (honest ledger)

The injection engine (`src/lib/injection-engine/types.ts`) is **THE primitive: five fields, four trigger kinds, three slot targets.** Every flavor (Skill, Steering, Instruction, Fact) is sugar over one `Injection`:

```ts
type InjectionTrigger =
  | { kind: 'always' }                                             // steering docs
  | { kind: 'rule';        activeWhen: (ctx: InjectionContext) => boolean }   // predicate / iteration
  | { kind: 'on-tool-return'; toolName: string | RegExp }          // "Dynamic ReAct" — fires after a tool returns
  | { kind: 'llm-activated';  viaToolName: string };               // the Skill flavor — read_skill('x') activates

interface InjectionContent { systemPrompt?; messages?; tools? }    // slot targets

interface InjectionContext {                                       // what rule/on-tool-return read
  iteration; userMessage; history;
  lastToolResult?: { toolName: string; result: string };
  activatedInjectionIds: readonly string[];
}
```

**So the routing primitive the user wants — "predicate on a tool result → activate a skill" — is already expressible** as a `rule` trigger reading `ctx.lastToolResult`, or an `on-tool-return` trigger for the coarse "any return of tool X". `read_skill` is `llm-activated`. Dynamic, token-efficient loading is what the engine already does.

| Already exists | Genuinely new (the "first") |
|---|---|
| injection engine (4 triggers, slots, `InjectionContext.lastToolResult`) | **`skillGraph()` builder** — declares edges as a graph |
| `read_skill` (`llm-activated`) + dynamic ReAct (token-efficient loading) | **graph extraction + `toMermaid()`** — declared = drawn |
| footprintjs chart / time-travel / recorders | **a skill = ONE drawn node** (instructions + tools + trigger + sub-procedure) |
| | **(v2) scoped `read_skill`** — gate the reachable skill set by graph position |

The activation *mechanism* is done; the **declarative + drawable layer** is what's new — which is exactly why this is a defensible first, not a rewrite.

---

## v1 API sketch (compiles to existing Injections)

```ts
import { Agent, skillGraph, defineSkill } from 'agentfootprint';

const triage = defineSkill({ id: 'mds-interface-issues', description: '…', body: '…', tools: [...] });
const sfp    = defineSkill({ id: 'sfp-diagnostics',       description: '…', body: '…', tools: [...] });
const io     = defineSkill({ id: 'io-profile',            description: '…', body: '…', tools: [...] });

const graph = skillGraph()
  .entry(triage)                                                  // reachable at turn start
  .route(triage, sfp, {                                           // DETERMINISTIC edge (you control it)
    when: (r) => r.toolName === 'get_interface_counters' && Number(JSON.parse(r.result).crc) > 0,
    label: 'CRC > 0',                                             // edge caption for the drawing
  })
  .route(triage, io)                                             // MODEL-fallback edge (read_skill within the allowed set)
  .build();

Agent.create({ provider, model }).skillGraph(graph).build();

graph.toMermaid();   // declared === drawn — hand this to your friend
```

**Edge → trigger compilation (no engine change for v1):**

| Builder call | Compiles to (on the *target* skill's Injection) |
|---|---|
| `.entry(skill)` | `trigger: { kind: 'rule', activeWhen: ctx => ctx.iteration === 1 }` (or `always`) |
| `.route(a, b, { when })` | `trigger: { kind: 'rule', activeWhen: ctx => !!ctx.lastToolResult && when(ctx.lastToolResult) }` |
| `.route(a, b, { onToolReturn: 'X' })` | `trigger: { kind: 'on-tool-return', toolName: 'X' }` (coarse: any return of X) |
| `.route(a, b)` (no predicate) | `trigger: { kind: 'llm-activated', viaToolName: 'read_skill' }` — model picks |

The **graph object** (`{ entry, edges: [{ from, to, kind, label }] }`) is what `toMermaid()` and the lens render. Edges are **model-additive and stateless** (each target's trigger is self-contained — it reads `lastToolResult` / `activatedInjectionIds`); `from` is informational for the drawing, not enforced. This matches the existing "skills accumulate, captured in the commit log" model and keeps deciders pure/testable.

**Determinism toggle (the market is converging here):** `when:`/`onToolReturn:` edges are **code-chosen** (deterministic, drawn solid); bare `.route(a,b)` edges are **model-chosen** (drawn dashed, like OpenAI's handoff arrows). Same picture, clear provenance — agentfootprint can claim both "deterministic workflow" and "agentic handoff" with one engine.

---

## Visualization

- `graph.toMermaid()` — declared topology (skills = nodes, edges labeled by predicate / `on-tool-return` / model).
- A `skillGraphRecorder()` in `agentfootprint/observe` so the **lens** overlays *which* edge actually fired at runtime (decide-evidence already captures the "why") on top of the declared graph — declared shape + runtime trace, the same way `TopologyRecorder`/`InOutRecorder` work today.

---

## Open questions

1. **Scoped `read_skill` (v2).** Today `read_skill` offers *all* skills. The "model picks within the allowed set" gating needs the engine to filter the `read_skill` skill list by graph position per iteration — the one genuine engine touch. v1 ships deterministic edges + drawing with **zero** engine change; v2 adds gating.
2. **Selection / parallel skills.** `.route(a, [b, c], { parallel: true })` → a selector fan-out (`failFast`?). Defer or include?
3. **Predicate input.** `when(lastToolResult)` vs `when(ctx)` (full `InjectionContext`). Start with `lastToolResult` (the common case) + an escape hatch to `ctx`.
4. **`from`-scoping.** v1 treats `from` as drawing-only (stateless, model-additive). If a real consumer needs hard gating ("`sfp` only reachable *after* `triage`"), that's the v2 scoped-activation work.

## Non-goals

- Planner / DAG generation (market-abandoned; the opposite of "author the graph").
- Pure LLM-picks-the-speaker blackboard routing (against "declared = drawn"; hard to visualize).
- Replacing free ReAct — `skillGraph()` is an **additional** mode, not a replacement for `reactMode: 'dynamic'`.

---

## Addendum — v3: decision-tree routing + interactive renderer (green-lit)

**Status:** v1 + v3 tree/compiler shipped (6.4.0); Neo ported to 11 skills. The
`<SkillGraphFlow>` interactive renderer (piece 3) is next.

### The de-risk: a decision tree compiles to the per-skill triggers we already have
Predicate **nodes** → skill **leaves** does NOT require an engine change. Each leaf
skill's trigger is the conjunction of the predicates on its root→leaf path, with
earlier-sibling negation for if/else exclusivity:

```
◇io? ─yes─▶ ◇per-LUN? ─yes─▶ lun-iops-breakdown
                        ─no──▶ io-profile
      ─no──▶ ◇interface? ─yes─▶ mds-interface-issues
```
compiles to:
```
lun-iops-breakdown.trigger   = rule(ctx => isIo(ctx)  && isPerLun(ctx))
io-profile.trigger           = rule(ctx => isIo(ctx)  && !isPerLun(ctx))
mds-interface-issues.trigger = rule(ctx => !isIo(ctx) && isInterface(ctx))
```
Runtime stays the **per-iteration trigger eval** (evaluator.ts) — which is exactly
why escalation / re-evaluation is correct (the tree is "re-walked" each turn via
the compiled triggers; it is NOT a one-shot traversal to a leaf). So v3 is a
**builder + compiler + renderer**, zero engine rewrite. `on-tool-return` edges
between skills layer on top (a leaf can route onward when a tool returns).

### v3 = three pieces
1. **Tree-declaration API** — `decide(...)` builds a plain **data node**; `.tree(root)`
   mounts it. The open "nested-builder vs data literal" question resolved toward the
   **data literal** — `decide` returns a value you compose and reuse, which is the
   cleanest to read AND the easiest to render (the renderer walks the same `nodes`):
   ```ts
   skillGraph()
     .tree(
       decide(isIoIntent,
         decide(isPerLun, lunSkill, ioSkill, 'per-LUN?'),
         decide(isInterface, interfaceSkill, healthSkill, 'interface?'),
         'io intent?'),
     )
     .build();
   ```
   Leaves are skills (`Injection`s); internal nodes are other `decide(...)` results.
   `decide(predicate, whenTrue, whenFalse, label?)` — `label` is the diamond caption.
   *(Shipped 6.4.0.)*
2. **Compiler** — `compileTree()` walks the tree and emits each leaf's
   path-conjunction `rule` trigger (with sibling negation), plus `graph.nodes`
   (`{ id, kind: 'predicate' | 'skill', label? }`) and branch edges for drawing.
   Pure; reuses the existing evaluator. Verified: each leaf compiles to a `rule`,
   and exactly one leaf fires per question **through the real evaluator**. *(Shipped
   6.4.0.)*
3. **Interactive renderer** — a `<SkillGraphFlow>` component (agentfootprint-lens,
   reusing its **React Flow / xyflow** stack — the same one the Lens chart uses):
   predicate **diamond** nodes + skill **leaf** nodes, two-panel (graph │ details),
   **click a node → see the skill** (body + tools) or the predicate. It consumes
   `graph.nodes` + `graph.edges` directly. This is the richer UX over the mermaid
   modal. `toMermaid()` stays as the lightweight/portable view. *(Next.)*

### Build order
(i) ✅ tree API (`decide` + `.tree`) + compiler + tests (routing model, no engine change) →
(ii) ✅ `<SkillGraphFlow>` xyflow renderer (clickable nodes → skill) →
(iii) ✅ point Neo's "Skill Graph" modal at `<SkillGraphFlow>` (replaces the mermaid
img with the interactive two-panel view).

## Addendum — routing provenance (6.5.0): capture *why* a skill was reached

The compiler knew the routing semantics but **compiled them away** into opaque
`activeWhen` closures — so when a skill activated, "why" (the decision path) was
gone. Fix: the compiler now stamps each skill's `metadata.skillGraph` with a
`SkillRouting` receipt (`via` + the root→leaf decision `path`). It's
observability-only — the trigger logic is unchanged.

- **Runtime:** the receipt rides out on `context.evaluated.routing` (structured
  JSON, per active skill-graph injection + unlocked tools); a `context.routed`
  commentary line narrates it ("routed to X, matched Y, N tools"); `agentThinkingTrace`
  leads each iteration's first Notepad beat with it.
- **Design-time:** the lens `<SkillGraphFlow>` shows the same path ("REACHED WHEN")
  in its detail panel, derived from the drawn edges (`routingPathTo`).

Zero engine change; non-skill-graph runs are byte-identical. Shipped: agentfootprint
6.5.0 + agentfootprint-lens 0.19.0.

---

*This memo is the agreed north star. v1 + v3 tree/compiler shipped; renderer next.*
