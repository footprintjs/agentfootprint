# agentfootprint — examples

Every example is a runnable end-to-end demo. Each one uses the
in-memory `MockProvider` so you can run them without an API key, and
each is doubled by a `.md` companion that explains *when to use it*
and *how it composes with other examples*.

## Running an example

```bash
# Run any single example end-to-end
npm run example examples/memory/01-window-strategy.ts

# Typecheck + run every example (used by CI)
npm run test:examples
```

`npm run example` is a thin wrapper around `tsx` with the right
runtime tsconfig. Substitute `npx tsx` directly only if you also set
`TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json` (the root tsconfig's
`paths` block points to `.d.ts` files for tsc, which trips `tsx` at
runtime).

## DNA progression — pick examples by where you are

```
┌─────────────────────────────────────────────────────────────────────┐
│  Foundation        →  core/         (LLMCall, Agent)                 │
│  Compositions      →  core-flow/    (Sequence, Parallel, …)          │
│  Patterns          →  patterns/     (ReAct, Reflexion, ToT, …)       │
│  Context shaping   →  context-engineering/  (Skill, Steering,        │
│                                              Instruction, Fact,      │
│                                              Dynamic-ReAct, mixed)   │
│  Memory            →  memory/       (Window, Budget, Summarize,      │
│                                      TopK, Extract, Causal ⭐, Hybrid)│
│  Production        →  features/     (Pause, Cost, Permissions,       │
│                                      Observability, Events)          │
└─────────────────────────────────────────────────────────────────────┘
```

## [`core/`](core/) — primitives

| # | File | Feature |
|---|---|---|
| 01 | [core/01-llm-call.ts](core/01-llm-call.ts) | `LLMCall` — one-shot LLM primitive |
| 02 | [core/02-agent-with-tools.ts](core/02-agent-with-tools.ts) | `Agent` — ReAct loop + tool registration |

## [`core-flow/`](core-flow/) — compositions

| # | File | Feature |
|---|---|---|
| 01 | [core-flow/01-sequence.ts](core-flow/01-sequence.ts) | `Sequence` — linear pipeline + `.pipeVia()` |
| 02 | [core-flow/02-parallel.ts](core-flow/02-parallel.ts) | `Parallel` — strict / tolerant fan-out |
| 03 | [core-flow/03-conditional.ts](core-flow/03-conditional.ts) | `Conditional` — predicate routing |
| 04 | [core-flow/04-loop.ts](core-flow/04-loop.ts) | `Loop` — iteration + mandatory budget |

## [`patterns/`](patterns/) — canonical patterns

| # | File | Paper |
|---|---|---|
| 01 | [patterns/01-self-consistency.ts](patterns/01-self-consistency.ts) | Wang et al., 2022 |
| 02 | [patterns/02-reflection.ts](patterns/02-reflection.ts) | Madaan et al., 2023 |
| 03 | [patterns/03-debate.ts](patterns/03-debate.ts) | Du et al., 2023 |
| 04 | [patterns/04-map-reduce.ts](patterns/04-map-reduce.ts) | Dean & Ghemawat, 2004 |
| 05 | [patterns/05-tot.ts](patterns/05-tot.ts) | Yao et al., 2023 |
| 06 | [patterns/06-swarm.ts](patterns/06-swarm.ts) | OpenAI Swarm |

## [`context-engineering/`](context-engineering/) — InjectionEngine flavors

The single `Injection` primitive with N typed sugar factories. All
flavors flow through one engine subflow + emit `context.injected`
with `source` discriminating per flavor.

| # | File | Flavor | Trigger |
|---|---|---|---|
| 01 | [context-engineering/01-instruction.ts](context-engineering/01-instruction.ts) | Instruction | rule (predicate) |
| 02 | [context-engineering/02-skill.ts](context-engineering/02-skill.ts) | Skill | LLM-activated (`read_skill`) |
| 03 | [context-engineering/03-steering.ts](context-engineering/03-steering.ts) | Steering | always-on |
| 04 | [context-engineering/04-fact.ts](context-engineering/04-fact.ts) | Fact | always-on (data) |
| 05 | [context-engineering/05-dynamic-react.ts](context-engineering/05-dynamic-react.ts) | Instruction | on-tool-return (4-iteration morph) |
| 06 | [context-engineering/06-mixed-flavors.ts](context-engineering/06-mixed-flavors.ts) | All four | mixed |

## [`memory/`](memory/) — defineMemory + 4 types × 7 strategies

`defineMemory({ type, strategy, store })` — single factory, dispatched
onto the right pipeline. Examples organized **by strategy** (the
discipline) since strategies are universal across types.

| # | File | Strategy | Type |
|---|---|---|---|
| 01 | [memory/01-window-strategy.ts](memory/01-window-strategy.ts) | Window — last N (rule) | Episodic |
| 02 | [memory/02-budget-strategy.ts](memory/02-budget-strategy.ts) | Budget — fit-to-tokens (decider) | Episodic |
| 03 | [memory/03-summarize-strategy.ts](memory/03-summarize-strategy.ts) | Summarize — LLM compresses older turns | Episodic |
| 04 | [memory/04-topK-strategy.ts](memory/04-topK-strategy.ts) | Top-K — semantic retrieval (relevance) | Semantic |
| 05 | [memory/05-extract-strategy.ts](memory/05-extract-strategy.ts) | Extract — LLM distills facts on write | Semantic |
| 06 | [memory/06-causal-snapshot.ts](memory/06-causal-snapshot.ts) | Top-K on snapshots ⭐ — replay decisions | **Causal** |
| 07 | [memory/07-hybrid-auto.ts](memory/07-hybrid-auto.ts) | Hybrid — recent + facts + causal | All |

⭐ Causal memory is the differentiator no other library has — persists
footprintjs decision-evidence snapshots so cross-run follow-ups
("why did you reject X last week?") get EXACT past facts.

## [`features/`](features/) — runtime features

| # | File | Feature |
|---|---|---|
| 01 | [features/01-pause-resume.ts](features/01-pause-resume.ts) | Human-in-the-loop via `pauseHere()` + `.resume()` |
| 02 | [features/02-cost-tracking.ts](features/02-cost-tracking.ts) | `pricingTable` + `costBudget` → `cost.tick` / `cost.limit_hit` |
| 03 | [features/03-permissions.ts](features/03-permissions.ts) | `permissionChecker` gating tool calls |
| 04 | [features/04-observability.ts](features/04-observability.ts) | `.enable.thinking()` + `.enable.logging()` |
| 05 | [features/05-events.ts](features/05-events.ts) | Typed `.on()` listeners, wildcards, `runner.emit()` |

## The closed taxonomy

```
2 primitives        +  3 compositions     +  N patterns          (pure composition)
   LLMCall              Sequence              SelfConsistency
   Agent                Parallel              Reflection
                        Conditional/Loop      Debate · MapReduce · ToT · Swarm
─────────────────────────────────────────────────────────────────────────────────
+ Context Engineering   +  Memory             +  Production features
   Injection (1) ×        Type × Strategy        Pause · Cost · Permissions ·
   N factories            × Store                Observability · Events
   (Skill / Steering /    (Episodic /
   Instruction / Fact)    Semantic /
                          Narrative /
                          Causal ⭐)
```

Every higher layer is pure composition over the lower layers — no
hidden primitives. New agent shapes are combinations of pieces
already shown in these examples.

<!-- AUTO-GENERATED:examples:start -->

## Examples by folder

_This section is auto-generated by `scripts/generate-examples-readme.mjs`._
_Run `npm run examples:readme` after adding/editing examples._

### [`core/`](core/) — primitives

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-llm-call.ts`](core/01-llm-call.ts) | LLMCall — one-shot LLM primitive | The atomic  |
| 02 | [`02-agent-with-tools.ts`](core/02-agent-with-tools.ts) | Agent + tools (ReAct) | Agent primitive with a tool registry. Each iteration: LLM call → route → tool-calls loop, or final. |

### [`core-flow/`](core-flow/) — compositions

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-sequence.ts`](core-flow/01-sequence.ts) | Sequence — linear pipeline | Chain runners; each step’s string output becomes the next step’s input. Use .pipeVia() to transform between steps. |
| 02 | [`02-parallel.ts`](core-flow/02-parallel.ts) | Parallel — fan-out + merge (strict / tolerant) | Fan out to N branches and merge. Fail-loud by default; opt into tolerant mode with .mergeOutcomesWithFn(). |
| 03 | [`03-conditional.ts`](core-flow/03-conditional.ts) | Conditional — predicate routing | Pick one runner via first-match predicate. .otherwise() is mandatory. |
| 04 | [`04-loop.ts`](core-flow/04-loop.ts) | Loop — iteration with mandatory budget | Iterate a body runner with a required budget: .times(n), .forAtMost(ms), or .until(guard). |

### [`patterns/`](patterns/) — canonical patterns

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-self-consistency.ts`](patterns/01-self-consistency.ts) | SelfConsistency (Wang et al., 2022) | Sample N answers in parallel with higher temperature, vote for the majority. Paper: https://arxiv.org/abs/2203.11171 |
| 02 | [`02-reflection.ts`](patterns/02-reflection.ts) | Reflection / Self-Refine (Madaan et al., 2023) | Loop(Propose → Critique) until the critic emits a DONE marker. Paper: https://arxiv.org/abs/2303.17651 |
| 03 | [`03-debate.ts`](patterns/03-debate.ts) | Multi-Agent Debate (Du et al., 2023) | Proposer and Critic alternate for N rounds; a Judge renders verdict. Paper: https://arxiv.org/abs/2305.14325 |
| 04 | [`04-map-reduce.ts`](patterns/04-map-reduce.ts) | MapReduce — split → summarize shards → combine | Fixed shard count; each branch runs one LLMCall; a reducer fn or merge-LLM combines. Classic long-document summarization pattern. |
| 05 | [`05-tot.ts`](patterns/05-tot.ts) | Tree of Thoughts (Yao et al., 2023) | BFS reasoning: Loop(Parallel(K thoughts)) with scoring + beam-width pruning each level. Paper: https://arxiv.org/abs/2305.10601 |
| 06 | [`06-swarm.ts`](patterns/06-swarm.ts) | Swarm — multi-agent handoff (OpenAI Swarm) | Fixed agent roster + route() function; Loop(Conditional(agent-select)) until route returns undefined. |

### [`context-engineering/`](context-engineering/) — InjectionEngine flavors

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-instruction.ts`](context-engineering/01-instruction.ts) | Instruction — rule-based system-prompt guidance | Predicate-driven instruction. Active when ctx matches; prompt text  |
| 02 | [`02-skill.ts`](context-engineering/02-skill.ts) | Skill — LLM-activated body + tools | LLM calls read_skill() to load a body of guidance + unlock tools.  |
| 03 | [`03-steering.ts`](context-engineering/03-steering.ts) | Steering — always-on system-prompt rule | Always-on guidance. Use for output format, persona, safety. Every  |
| 04 | [`04-fact.ts`](context-engineering/04-fact.ts) | Fact — developer-supplied data injection | Inject data (user profile, env info, current time) the LLM should  |
| 05 | [`05-dynamic-react.ts`](context-engineering/05-dynamic-react.ts) | Dynamic ReAct — context morphs each iteration | Skills activate, instructions fire after specific tools, facts  |
| 06 | [`06-mixed-flavors.ts`](context-engineering/06-mixed-flavors.ts) | Mixed flavors — all 4 in one agent | One agent with steering + instruction + skill + fact registered side-by-side.  |
| 07 | [`07-rag.ts`](context-engineering/07-rag.ts) | RAG — retrieval-augmented generation | Embed user query, retrieve top-K documents, inject as user-role  |
| 08 | [`08-mcp.ts`](context-engineering/08-mcp.ts) | MCP — Model Context Protocol client | Connect to an MCP server, expose its tools as agentfootprint Tool[].  |

### [`memory/`](memory/) — defineMemory + 4 types × 7 strategies

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-window-strategy.ts`](memory/01-window-strategy.ts) | Window strategy — last N turns (short-term, rule-based) | Sliding window over recent conversation. Cheap (no LLM, no embeddings)  |
| 02 | [`02-budget-strategy.ts`](memory/02-budget-strategy.ts) | Budget strategy — fit-to-tokens (decider-based) | Token-aware memory selection. Picks the most-recent entries that  |
| 03 | [`03-summarize-strategy.ts`](memory/03-summarize-strategy.ts) | Summarize strategy — LLM compresses older turns | Long-conversation compaction: keep recent N turns raw, summarize  |
| 04 | [`04-topK-strategy.ts`](memory/04-topK-strategy.ts) | Top-K strategy — semantic retrieval (relevance, not recency) | Vector retrieval: embed the user query, return top-K cosine-similar  |
| 05 | [`05-extract-strategy.ts`](memory/05-extract-strategy.ts) | Extract strategy — LLM distills facts/beats on write | Smart-write: an extractor (pattern-based or LLM-backed) pulls  |
| 06 | [`06-causal-snapshot.ts`](memory/06-causal-snapshot.ts) | Causal memory — store footprintjs snapshots, replay decisions | The differentiator: persist past run snapshots tagged with the  |
| 07 | [`07-hybrid-auto.ts`](memory/07-hybrid-auto.ts) | Hybrid — compose recent + facts + causal snapshots | Stack multiple memory types on one agent: short-term window,  |
| 08 | [`08-redis-store.ts`](memory/08-redis-store.ts) | RedisStore — persistent MemoryStore via Redis | Drop-in replacement for InMemoryStore that persists entries in Redis.  |
| 09 | [`09-agentcore-store.ts`](memory/09-agentcore-store.ts) | AgentCoreStore — AWS Bedrock AgentCore Memory adapter | Persist conversation memory in AWS Bedrock AgentCore. Mock-injected  |

### [`features/`](features/) — runtime features

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-pause-resume.ts`](features/01-pause-resume.ts) | Pause / Resume — human-in-the-loop | Two-phase HITL: run() may pause and return a checkpoint; resume(checkpoint, answer) finishes the run from the human\'s reply. Process A and Process B can be days apart. |
| 02 | [`02-cost-tracking.ts`](features/02-cost-tracking.ts) | Cost tracking — pricingTable + costBudget | Add a PricingTable adapter to get cost.tick after every LLM call; add costBudget to get a one-shot cost.limit_hit on threshold crossing. |
| 03 | [`03-permissions.ts`](features/03-permissions.ts) | Permissions — tool-call gating | Supply a PermissionChecker; Agent calls check() before every tool.execute and emits permission.check events. Deny skips the tool. |
| 04 | [`04-observability.ts`](features/04-observability.ts) | Observability — enable.thinking + enable.logging | One-liner Tier-3 observability: .enable.thinking for status line + .enable.logging for firehose structured logs. |
| 05 | [`05-events.ts`](features/05-events.ts) | Events — typed .on() + wildcards + runner.emit() | The 47-event typed registry: .on(type, listener) is compile-time checked; wildcards (* / domain.*) for broad subscriptions; runner.emit() for consumer events. |
| 06 | [`06-detached-observability.ts`](features/06-detached-observability.ts) | Detached observability — non-blocking telemetry export | Wire the new  |
| 06 | [`06-flowchart-boundary-payloads.ts`](features/06-flowchart-boundary-payloads.ts) | Flowchart — subflow boundary payloads (entry/exit) | Every subflow StepNode carries entryPayload + exitPayload sourced from footprintjs BoundaryRecorder. Bound by runtimeStageId. |
| 06 | [`06-status-subpath.ts`](features/06-status-subpath.ts) | Status subpath — selectThinkingState + renderThinkingLine + templates | Low-level chat-bubble status: derive ThinkingState from events, render via per-tool templates with var interpolation. Sister to enable.thinking; this is the primitive consumers compose into custom UIs. |
| 07 | [`07-mock-multi-turn-replies.ts`](features/07-mock-multi-turn-replies.ts) | Mock — scripted multi-turn replies (deterministic ReAct) | mock({ replies: [...] }) drives a tool-using ReAct loop with exact,  |
| 08 | [`08-reliability.ts`](features/08-reliability.ts) | Reliability — CircuitBreaker + outputFallback + resumeOnError | End-to-end demo of the v2.10.x Reliability subsystem: vendor-outage circuit breaker, 3-tier output-schema degradation, and fault-tolerant mid-run resume from JSON-serializable checkpoint. |
| 09 | [`09-reliability-gate.ts`](features/09-reliability-gate.ts) | Reliability gate — rules-based retry / fallback / fail-fast around CallLLM | v2.11.5 — declarative reliability rules wrapping every LLM call inside an Agent loop. Demonstrates happy path, transient-retry recovery, and post-decide fail-fast → typed ReliabilityFailFastError. Streaming + reliability uses first-chunk arbitration: pre-first-chunk failures honor the full rule set; mid-stream failures only honor ok / fail-fast. |
| 10 | [`10-discovery-provider.ts`](features/10-discovery-provider.ts) | Discovery-style ToolProvider — async list() over a tool hub with TTL cache | v2.11.6 — ToolProvider.list(ctx) may return Promise<Tool[]> for runtime tool catalogs (Rube, MCP, custom hubs). Demonstrates TTL caching, ctx.signal propagation, and the agentfootprint.tools.discovery_failed event when discovery throws. Sync providers still pay zero overhead. |
| 11 | [`11-sequence-policy.ts`](features/11-sequence-policy.ts) | Sequence-aware permission policy — security + cost + correctness on PermissionChecker | v2.12 — extended PermissionChecker receives sequence + history + iteration + identity + signal in check ctx. New halt result terminates the run with typed PolicyHaltError. tellLLM controls the synthetic tool_result the LLM sees. Demonstrates security (exfil chain halt), cost (deny + recover), correctness (idempotency cap). |

### [`canonical/`](canonical/) — end-to-end patterns

| # | File | Title | Description |
|---|---|---|---|
| — | [`loan-officer-causal.ts`](canonical/loan-officer-causal.ts) | Canonical: Loan officer with causal-memory cross-run replay | Monday: expensive model underwrites loan #42 (REJECT). Friday: cheap model answers  |

### [`dynamic-react/`](dynamic-react/) — examples

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-classic-react.ts`](dynamic-react/01-classic-react.ts) | Classic ReAct — every tool on every iteration | All 12 tools registered up front. Every LLM call ships every  |
| 02 | [`02-dynamic-react.ts`](dynamic-react/02-dynamic-react.ts) | Dynamic ReAct — tools narrow via autoActivate skills | Same 12 tools as 01-classic-react.ts, but behind 3 skills with  |

<!-- AUTO-GENERATED:examples:end -->
