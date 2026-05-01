# Connected Data — the Palantir lineage

> **In one line:** disconnected data forces the agent to re-discover relationships every iteration, burning tokens and time. Connect the data once, and every subsequent token compounds the connection instead of paying for it again.

## The thesis Palantir was founded on (2003)

Pre-Palantir counter-terrorism analysts had access to enormous data — financial transactions, travel manifests, communications metadata, watchlists, NGO reports, satellite imagery — sitting in stovepiped agency silos. The bottleneck wasn't the data; it was that **following one entity's thread across silos took weeks of manual correlation**. An analyst would screenshot a name from one tool, paste it into another, manually align timestamps from a third, and rebuild the connection from scratch every time the question changed slightly.

Palantir's bet: the connections themselves are first-class. Build an **ontology layer** that names the entities, types the events, and links them once at ingest time. Now the analyst's question — "what does this person have to do with that wire transfer to that NGO three years ago" — collapses from weeks to minutes, because the framework holds the connections, not the analyst's working memory.

That bet aged well. Foundry generalized it from intel to enterprise, where the same disconnected-data symptom shows up in every Fortune-500 data lake.

## Why this returns in the agentic era

LLM agents face the same fragmentation problem at *runtime*, not at ingest time:

- The agent reads a tool result. The result references entities the agent saw three turns ago.
- The agent makes a decision. Two iterations later, it needs to know *why* that decision was made.
- The agent uses memory. The memory store knows *what* was said but not *why*.
- The agent loops. Each iteration re-discovers state the previous iteration already established.

Each rediscovery costs **tokens** (re-asking, re-explaining, re-deriving) and **iterations** (more LLM round-trips). At small scale this is invisible. At production scale it's the dominant cost driver — and worse, it's the cost driver that *grows with the complexity of the task*, not just with traffic.

This is the same arithmetic Palantir was attacking in 2003. Different decade, different layer, same shape.

## The four classes of agent data — and how agentfootprint connects each

| Class | The disconnected default | How agentfootprint connects it |
|---|---|---|
| **State** | Tool calls return JSON; if the agent needs that JSON later it has to rederive it from messages | **`TypedScope<S>`** — single typed shared state, every read/write tracked; later stages access by key, not by re-parsing messages |
| **Decisions** | LLM picks a branch, reasoning lost; debugging means re-running with logging | **`decide()` evidence** — every branch carries the inputs that triggered it (`FunctionRuleEvidence.inputs[]`); replayable, diff-able |
| **Execution** | Stages run, outputs scattered across messages and tool results; no time-correlation | **`commitLog` + `runtimeStageId`** — every state mutation keyed to its writing stage; backtracking ("who last wrote `systemPrompt`?") is O(log n) lookup, not log search |
| **Memory** | Memory stores the LAST message; new sessions can't see the prior session's reasoning | **Causal memory** (`defineMemory({ type: CAUSAL })`) — stores full footprintjs snapshots: every key, every decision, every commit. Cosine-matched on follow-up runs |

The four are **interconnected by design**: `runtimeStageId` is the glue. It connects:

- Recorder events to the stage that emitted them
- commitLog entries to the stage that committed them
- Memory snapshots to the run that produced them
- Decision evidence to the iteration that invoked the decider

So when you ask "why did the agent do X?", you get back the full chain — the decision evidence, the inputs that triggered it, the stages that produced those inputs, and the iteration index in which it happened. **One graph, four ways in.**

## The arithmetic — connected data → fewer tokens

Concretely: a Dynamic ReAct agent with skill activation has a stable system prefix (steering + active skill body) that recurs across iterations. Without connection, the agent re-derives "what skill is active" from messages every iter (or worse, re-pays the prompt cost every iter). With connection:

- `activeInjections` lives in scope — read in O(1) per iter
- The cache layer reads `activeInjections` and emits `CacheMarker[]` so the stable prefix is paid for once and read for cents on subsequent iters
- `decide()` evidence in the CacheGate captures *why* caching was on or off this turn — debug without re-running

Net measured result on a 10-skill / 18-tool agent: **−77% input tokens** (Sonnet, 28,404 → 6,535) just from connecting state + decisions + execution properly. That number isn't a benchmark trick — it's the Palantir multiplier showing up at agent runtime.

## Where we go beyond Palantir

Palantir's ontology is **pre-built**: data engineers design the schema, populate the entity types, and the analyst queries the ontology. Heavy lift before the first question. Excellent for stable enterprise data that pays back the upfront cost over years.

agentfootprint's "ontology" is **emergent per-run**: TypedScope's schema is just `interface State { ... }`, the commitLog accumulates as stages run, and the connections form as decisions fire. No pre-build cost. The trade-off: connections are scoped to one run (or one Causal-memory-backed sequence of runs), not to a perpetual enterprise graph.

That's actually a feature for the agentic era. The decision context for "which port has the worst CRC errors right now" doesn't need to live in an ontology for years; it needs to be reconstructable for *this run* and replayable when something goes wrong. **Trace-time connection** beats **catalog-time connection** when the questions are short-lived and high-cardinality, which describes most agent workloads.

## The takeaway

If you remember one sentence from this page:

> **Every iteration the agent has to re-discover something is an iteration that didn't have to happen. agentfootprint's design exists to minimize re-discovery by making connections persistent across the four classes of agent data.**

That's the user-visible win — fewer iterations, fewer tokens, faster answers. The engineering discipline that makes it tractable to *implement* connection without ending up with a tangled monolith is the [Liskov modularity](./modularity-liskov.md) story.

## Further reading

- Palantir Foundry overview: https://www.palantir.com/platforms/foundry/
- The original *Federalist* / Palantir co-founders' essays on intel-system design (e.g., Karp, Cohen)
- *The Mythical Man-Month* (Brooks, 1975) — Ch. 16 "No Silver Bullet" frames "essential complexity" the way Palantir frames data fragmentation
