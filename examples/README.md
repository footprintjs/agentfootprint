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
("why did you reject X last week?") answer from the stored decisions + tool evidence.

## [`features/`](features/) — runtime features

| # | File | Feature |
|---|---|---|
| 01 | [features/01-pause-resume.ts](features/01-pause-resume.ts) | Human-in-the-loop via `pauseHere()` + `.resume()` |
| 02 | [features/02-cost-tracking.ts](features/02-cost-tracking.ts) | `pricingTable` + `costBudget` → `cost.tick` / `cost.limit_hit` |
| 03 | [features/03-permissions.ts](features/03-permissions.ts) | `permissionChecker` gating tool calls |
| 04 | [features/04-observability.ts](features/04-observability.ts) | `.enable.liveStatus()` + `.enable.observability()` |
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
| 01 | [`01-llm-call.ts`](core/01-llm-call.ts) | LLMCall — one-shot LLM primitive | The atomic "ask the model once" primitive — composes into every  |
| 02 | [`02-agent-with-tools.ts`](core/02-agent-with-tools.ts) | Agent + tools (ReAct) | Agent primitive with a tool registry. Each iteration: LLM call → route → tool-calls loop, or final. |

### [`core-flow/`](core-flow/) — compositions

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-sequence.ts`](core-flow/01-sequence.ts) | Sequence — linear pipeline | Chain runners; each step’s string output becomes the next step’s input. Use .pipeVia() to transform between steps. |
| 02 | [`02-parallel.ts`](core-flow/02-parallel.ts) | Parallel — fan-out + merge (strict / tolerant) | Fan out to N branches and merge. Fail-loud by default; opt into tolerant mode with .mergeOutcomesWithFn(). |
| 03 | [`03-conditional.ts`](core-flow/03-conditional.ts) | Conditional — predicate routing | Pick one runner via first-match predicate. .otherwise() is mandatory. |
| 04 | [`04-loop.ts`](core-flow/04-loop.ts) | Loop — iteration with mandatory budget | Iterate a body runner with a required budget: .times(n), .forAtMost(ms), or .until(guard). |
| 05 | [`05-workflow.ts`](core-flow/05-workflow.ts) | workflow — typed steps, compile-checked hand-offs | Chain 1–8 runners where step N’s output type must be step N+1’s input type. Structured values survive the hand-off; a broken chain is a compile error. |
| 06 | [`06-graph.ts`](core-flow/06-graph.ts) | graph — a fixed DAG, with the concurrency worked out for you | Declare nodes and edges; independent nodes run concurrently. Cycles, unknown edge endpoints and un-joined fan-in are refused at build time. |

### [`patterns/`](patterns/) — canonical patterns

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-self-consistency.ts`](patterns/01-self-consistency.ts) | SelfConsistency (Wang et al., 2022) | Sample N answers in parallel with higher temperature, vote for the majority. Paper: https://arxiv.org/abs/2203.11171 |
| 02 | [`02-reflection.ts`](patterns/02-reflection.ts) | Reflection / Self-Refine (Madaan et al., 2023) | Loop(Propose → Critique) until the critic emits a DONE marker. Paper: https://arxiv.org/abs/2303.17651 |
| 03 | [`03-debate.ts`](patterns/03-debate.ts) | Multi-Agent Debate (Du et al., 2023) | Proposer and Critic alternate for N rounds; a Judge renders verdict. Paper: https://arxiv.org/abs/2305.14325 |
| 04 | [`04-map-reduce.ts`](patterns/04-map-reduce.ts) | MapReduce — split → summarize shards → combine | Fixed shard count; each branch runs one LLMCall; a reducer fn or merge-LLM combines. Classic long-document summarization pattern. |
| 05 | [`05-tot.ts`](patterns/05-tot.ts) | Tree of Thoughts (Yao et al., 2023) | BFS reasoning: Loop(Parallel(K thoughts)) with scoring + beam-width pruning each level. Paper: https://arxiv.org/abs/2305.10601 |
| 06 | [`06-swarm.ts`](patterns/06-swarm.ts) | Swarm — multi-agent handoff (OpenAI Swarm) | Fixed agent roster + route() function; Loop(Conditional(agent-select)) until route returns undefined. |
| 07 | [`07-llm-swarm.ts`](patterns/07-llm-swarm.ts) | llmSwarm — LLM-decided hand-offs | Roster with descriptions → router prompt; the LLM answers {agentId?, message, reason?} and the swarm dispatches on it. No agentId = final answer. |

### [`context-engineering/`](context-engineering/) — InjectionEngine flavors

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-instruction.ts`](context-engineering/01-instruction.ts) | Instruction — rule-based system-prompt guidance | Predicate-driven instruction. Active when ctx matches; prompt text  |
| 02 | [`02-skill.ts`](context-engineering/02-skill.ts) | Skill — LLM-activated body + tools | LLM calls read_skill() to load a body of guidance; autoActivate keeps  |
| 03 | [`03-steering.ts`](context-engineering/03-steering.ts) | Steering — always-on system-prompt rule | Always-on guidance. Use for output format, persona, safety. Every  |
| 04 | [`04-fact.ts`](context-engineering/04-fact.ts) | Fact — developer-supplied data injection | Inject data (user profile, env info, current time) the LLM should  |
| 05 | [`05-dynamic-react.ts`](context-engineering/05-dynamic-react.ts) | Dynamic ReAct — context morphs each iteration | Skills activate, instructions fire after specific tools, facts  |
| 06 | [`06-mixed-flavors.ts`](context-engineering/06-mixed-flavors.ts) | Mixed flavors — all 4 in one agent | One agent with steering + instruction + skill + fact registered side-by-side.  |
| 07 | [`07-rag.ts`](context-engineering/07-rag.ts) | RAG — retrieval-augmented generation | Embed user query, retrieve top-K documents, inject as user-role  |
| 08 | [`08-mcp.ts`](context-engineering/08-mcp.ts) | MCP — Model Context Protocol client | Connect to an MCP server, expose its tools as agentfootprint Tool[].  |
| 09 | [`09-skills-from-dir.ts`](context-engineering/09-skills-from-dir.ts) | Skills from a directory of SKILL.md files | Load Skills from SKILL.md files — frontmatter is the disclosure stub, the  |
| 10 | [`10-mcp-serve.ts`](context-engineering/10-mcp-serve.ts) | MCP — serve your tools to other clients | Expose agentfootprint Tool[] AS an MCP server. Schemas map 1:1, the served  |
| 11 | [`11-compaction.ts`](context-engineering/11-compaction.ts) | Compaction — a smaller window, the same record | Folds the oldest turns into one summary when the measured window  |
| 12 | [`12-window-strategies.ts`](context-engineering/12-window-strategies.ts) | Window strategies — slidingWindow and tokenBudget | Runs one conversation under slidingWindow and tokenBudget, showing that  |
| 13 | [`13-messages-delivery.ts`](context-engineering/13-messages-delivery.ts) | Messages delivery — declared content, delivered into the window | slot:'messages' appends to scope.history with a role you name. Roles a  |
| 14 | [`14-durable-compaction.ts`](context-engineering/14-durable-compaction.ts) | Durable compaction — a week-old summary you can still unpack | Folds a long window into a summary, stores the conversation in a SQLite  |

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
| 10 | [`10-durable-vector-index.ts`](memory/10-durable-vector-index.ts) | Durable vector index — embed the corpus once, ever | sqliteVectorStore keeps the corpus in one file, so a restart re-embeds  |
| 11 | [`11-decay-strategy.ts`](memory/11-decay-strategy.ts) | Decay strategy — old memory fades on a half-life | Score every recalled entry by age against a half-life and drop what has  |

### [`features/`](features/) — runtime features

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-pause-resume.ts`](features/01-pause-resume.ts) | Pause / Resume — human-in-the-loop | Two-phase HITL: run() may pause and return a checkpoint; resume(checkpoint, answer) finishes the run from the human\'s reply. Process A and Process B can be days apart. |
| 02 | [`02-cost-tracking.ts`](features/02-cost-tracking.ts) | Cost tracking — pricingTable + costBudget | Add a PricingTable adapter to get cost.tick after every LLM call; add costBudget to get a one-shot cost.limit_hit on threshold crossing. |
| 03 | [`03-permissions.ts`](features/03-permissions.ts) | Permissions — tool-call gating | Supply a PermissionChecker; Agent calls check() before every tool.execute and emits permission.check events. Deny skips the tool. |
| 04 | [`04-observability.ts`](features/04-observability.ts) | Observability — enable.liveStatus + enable.observability | Strategy-based Tier-3 observability: .enable.liveStatus for a status line + .enable.observability for firehose structured logs. |
| 05 | [`05-events.ts`](features/05-events.ts) | Events — typed .on() + wildcards + runner.emit() | The 47-event typed registry: .on(type, listener) is compile-time checked; wildcards (* / domain.*) for broad subscriptions; runner.emit() for consumer events. |
| 06 | [`06-detached-observability.ts`](features/06-detached-observability.ts) | Detached observability — non-blocking telemetry export | Wire the `detach` option on `enable.observability` so slow exporters never block the agent loop. Drain with one line on shutdown: `await telemetry.flush()`. |
| 06 | [`06-flowchart-boundary-payloads.ts`](features/06-flowchart-boundary-payloads.ts) | Flowchart — subflow boundary payloads (entry/exit) | Every subflow StepNode carries entryPayload + exitPayload sourced from footprintjs BoundaryRecorder. Bound by runtimeStageId. |
| 06 | [`06-status-subpath.ts`](features/06-status-subpath.ts) | Status subpath — selectStatus + renderStatusLine + templates | Low-level chat-bubble status: derive StatusState from events, render via per-tool templates with var interpolation. Sister to enable.liveStatus; this is the primitive consumers compose into custom UIs. |
| 06 | [`06-tool-args-validation.ts`](features/06-tool-args-validation.ts) | Tool-args validation — model-visible retry | LLM-produced tool args are validated against the tool's inputSchema before dispatch (default 'enforce'). Mismatches reject the call with a structured retry message; the model self-corrects next iteration. |
| 07 | [`07-mock-multi-turn-replies.ts`](features/07-mock-multi-turn-replies.ts) | Mock — scripted multi-turn replies (deterministic ReAct) | mock({ replies: [...] }) drives a tool-using ReAct loop with exact,  |
| 08 | [`08-reliability.ts`](features/08-reliability.ts) | Reliability — CircuitBreaker + outputFallback + resumeOnError | End-to-end demo of the v2.10.x Reliability subsystem: vendor-outage circuit breaker, 3-tier output-schema degradation, and fault-tolerant mid-run resume from JSON-serializable checkpoint. |
| 09 | [`09-reliability-gate.ts`](features/09-reliability-gate.ts) | Reliability gate — rules-based retry / fallback / fail-fast around CallLLM | v2.11.5 — declarative reliability rules wrapping every LLM call inside an Agent loop. Demonstrates happy path, transient-retry recovery, and post-decide fail-fast → typed ReliabilityFailFastError. Streaming + reliability uses first-chunk arbitration: pre-first-chunk failures honor the full rule set; mid-stream failures only honor ok / fail-fast. |
| 10 | [`10-discovery-provider.ts`](features/10-discovery-provider.ts) | Discovery-style ToolProvider — async list() over a tool hub with TTL cache | v2.11.6 — ToolProvider.list(ctx) may return Promise<Tool[]> for runtime tool catalogs (Rube, MCP, custom hubs). Demonstrates TTL caching, ctx.signal propagation, and the agentfootprint.tools.discovery_failed event when discovery throws. Sync providers still pay zero overhead. |
| 11 | [`11-sequence-policy.ts`](features/11-sequence-policy.ts) | Sequence-aware permission policy — security + cost + correctness on PermissionChecker | v2.12 — extended PermissionChecker receives sequence + history + iteration + identity + signal in check ctx. New halt result terminates the run with typed PolicyHaltError. tellLLM controls the synthetic tool_result the LLM sees. Demonstrates security (exfil chain halt), cost (deny + recover), correctness (idempotency cap). |
| 12 | [`12-strict-output.ts`](features/12-strict-output.ts) | Strict output — Instructor-style schema-retry on the reliability gate | v2.13 — outputSchema validation now runs INSIDE the reliability gate. When validation fails, postDecide rules can retry with feedbackForLLM (an ephemeral user message describing the validation error). New helpers: defaultStuckLoopRule fail-fasts after 2 identical errors. ValidationFailure sentinel. lastNValidationErrorsMatch helper. Demonstrates happy / retry-with-feedback / stuck-loop paths. |
| 13 | [`13-live-state.ts`](features/13-live-state.ts) | Live state — O(1) "is it happening NOW" reads | liveStateRecorder() bundles three trackers (LLM / tool / turn) on the BoundaryStateStore storage primitive. Subscribe once, read O(1) at any moment. |
| 14 | [`14-tool-lineage.ts`](features/14-tool-lineage.ts) | Tool lineage — auto-derive the tool→tool data-flow graph | Attach toolLineageRecorder() to reconstruct which tool RESULT fed which later tool CALL, by value provenance — the data-flow graph causalChain can't see in a ReAct loop. |
| 15 | [`15-skill-graph.ts`](features/15-skill-graph.ts) | Skill graph — declarative, token-efficient skill routing | Declare an entry skill + routing edges; each edge compiles to an injection trigger so skills load just-in-time. Deterministic, drawable (toMermaid), zero engine change. |
| 16 | [`16-providers.ts`](features/16-providers.ts) | LLM providers — pick by env (Azure OpenAI / Anthropic / OpenAI / mock) | One agent, swappable provider. Azure OpenAI via azureOpenai(); OpenAI-compatible company endpoints via openai({ baseURL }); mock for $0 offline runs. Same LLMProvider interface. |
| 17 | [`17-identity.ts`](features/17-identity.ts) | Identity — a tool vends a downstream OAuth credential (AgentCore) |  |
| 18 | [`18-otel-genai.ts`](features/18-otel-genai.ts) | OTel GenAI conventions — gen_ai.* spans + decision-evidence span events | otelObservability emits GenAI-semconv spans (invoke_agent / chat / execute_tool) plus explainability span events: route decisions, decide() evidence, validation, permission, credential. |
| 19 | [`19-audit-export.ts`](features/19-audit-export.ts) | Tamper-evident audit export — hash-chained bundle + offline verification | auditExport() hash-chains every typed event (decisions, tool calls, validation rejections) into a JSON AuditBundle; verifyAuditBundle() recomputes the chain offline and names the exact record any tamper broke. |
| 20 | [`20-regulated-decisioning.ts`](features/20-regulated-decisioning.ts) | Regulated decisioning — one run, three compliance artifacts, offline auditor | A loan-decisioning agent declines an application under labeled decide() rules while auditExport (hash chain), otelObservability (GenAI spans) and causal memory capture the same event stream; an offline auditor then answers "why was the applicant declined?" from the persisted JSON alone — and a flipped byte is caught and named. |
| 21 | [`21-deferred-observers.ts`](features/21-deferred-observers.ts) | Deferred observers — non-blocking agent.on() (RFC-001) | observerDelivery: deferred moves slow agent.on() listeners off the ReAct hot path — capture inline, deliver one beat behind, drain before run() returns. Benches inline vs deferred vs no-listener. |
| 22 | [`22-influence-core.ts`](features/22-influence-core.ts) | influence-core — four-signal evidence scoring, one shared embedding cache | The shared scoring engine under the FDL evidence ranking, the tool-catalog  |
| 23 | [`23-skill-graph-scoped-read-skill.ts`](features/23-skill-graph-scoped-read-skill.ts) | Skill graph — scoped read_skill (stay on the trail) | The read_skill gate bounds the model to skills reachable from the current cursor; an out-of-reach jump is rejected with a re-prompt naming the allowed skills. A skill the graph never wires is open from any cursor and never moves it. Plain read_skill agents are unaffected. |
| 24 | [`24-skill-graph-entry-relevance.ts`](features/24-skill-graph-entry-relevance.ts) | Skill graph — relevance entry routing (entryByRelevance) | Pick the starting skill by embedding-similarity to the message (softmax over each entry description) instead of regex — LLM-free, reproducible, with relevance % for the Why-panel. Only the picked entry loads. |
| 25 | [`25-skill-graph-checkup.ts`](features/25-skill-graph-checkup.ts) | Skill graph — build-time check-up + object form + the refusals | graph.checkup() / .build({ check }) flags unreachable skills, unknown ids, ambiguous routes, no-entry, and self-loops before you run. The object-literal form lists skills independently of the wiring so the check-up catches a listed-but-unwired skill. Past reporting: the five declarations the library refuses outright, each message naming the fix. |
| 26 | [`26-skill-graph-route-recorder.ts`](features/26-skill-graph-route-recorder.ts) | Skill graph — routeRecorder + governors | routeRecorder() records the skill path a run took (getPath/getHops) + rejected read_skill jumps (getRejections) + governor trips (getTrips: oscillation / rejected-cap), by composing the shipped context.evaluated + skill.rejected events. No engine change. |
| 27 | [`27-skill-graph-relevance-hint.ts`](features/27-skill-graph-relevance-hint.ts) | Skill graph — defineRelevanceHint (advisory entry note) | When entryByRelevance picks the start skill but its top entries are a near-tie, defineRelevanceHint injects a non-binding, anti-anchoring note for that turn ("a keyword scorer ranked these close — use your judgment"). Reads ctx.entryScores; rides context.evaluated, no new event. |
| 28 | [`28-skill-graph-entry-read.ts`](features/28-skill-graph-entry-read.ts) | Skill graph — LLM-read entry routing (entryByRead, no embedder) | With multiple entry skills and no embedder, .entryByRead() lets the agent’s own LLM read the entry menu and pick the start skill via read_skill. Entries stay exclusive (only the pick loads); the first turn injects no entry body. |
| 29 | [`29-skill-contract-check.ts`](features/29-skill-contract-check.ts) | Skill graph — body ↔ tool-contract check (catch "told about an uncallable tool") | graph.checkup() runs a deterministic body↔tool consistency pass: body-foreign-tool (body names a tool from another skill) and body-unknown-tool (a tool_name( reference to a tool that exists nowhere). Both are warnings; checkSkillContract checks a skill standalone. |
| 30 | [`30-tool-contract-checkup.ts`](features/30-tool-contract-checkup.ts) | Tool contract — diff agent schemas vs a server /tools catalog | toolContractCheckup(agentTools, serverCatalog) is a pure diff of an agent’s tool inputSchemas against a tool-server catalog (e.g. GET /tools): required-divergence (error), optional-drift / arg-divergence / dead-endpoint / missing-on-server. Catch the "tool 404s / omits a required arg / ignores my filter" class at build time. |
| 31 | [`31-skill-graph-keyword-scorer.ts`](features/31-skill-graph-keyword-scorer.ts) | Skill graph — pluggable entry scorer (+ no-embedder keyword router) | Route the starting skill with a pluggable scorer strategy: keywordScorer() (word overlap, no embedder), embeddingScorer(e) (semantic), or your own EntryScorer. The chosen scorer name + ranking land on the snapshot for the Why-panel. |
| 32 | [`32-context-ledger.ts`](features/32-context-ledger.ts) | _no meta_ | — |
| 33 | [`33-checkin.ts`](features/33-checkin.ts) | Check in with the receipts | A tool demands human consent for a consequential action; the ask carries an evidence pack (willDo / read / drivers / trail) and the decision lands as a typed record. |
| 34 | [`34-checkin-coworker.ts`](features/34-checkin-coworker.ts) | The coworker with the receipts | A runnable AI-coworker demo: it drafts a weekly status doc, then pauses for human consent before posting to the team channel. The check-in ask rides an evidence pack (willDo / read / drivers / trail) rendered as readable receipts, and the decision lands in an audit trail. |
| 35 | [`35-resilience-visibility.ts`](features/35-resilience-visibility.ts) | Resilience visibility — which provider actually served | The provider decorators report what they did, so the three declared events (fallback.triggered / error.retried / error.recovered) now fire from inside the run with real runId + runtimeStageId. Shows a failover, a retry-then-recover, the whole stack inside a recordRun() recording, and the honest limits (the breaker has no event of its own; outside a run nothing is emitted). |
| 36 | [`36-per-run-config.ts`](features/36-per-run-config.ts) | Per-run config — .configure() | Resolve this run model and system prompt at run start, and commit what was  |
| 37 | [`37-middleware.ts`](features/37-middleware.ts) | Middleware — allow, deny, ask | A typed chain around every tool dispatch and around the message boundary.  |
| 38 | [`38-act.ts`](features/38-act.ts) | act() — the five moments of the loop | One block that says what an agent does at every moment of its turn: input,  |
| 39 | [`39-approve-once.ts`](features/39-approve-once.ts) | Approve once — session trust that says whose trust it is | A ~10-line tool middleware: the first matching call asks a person, the decision  |
| 40 | [`40-output-schema-retry.ts`](features/40-output-schema-retry.ts) | The schema teaches back — retries on outputSchema | 7.26 — `.outputSchema(parser, { retries })` turns a schema failure into a corrective turn: the failed answer and an authored frame quoting the validator go back to the model, the ReAct loop re-enters, and the next attempt is a real turn with its own LLM bracket and cost tick. Exhaustion throws OutputSchemaError exactly as before. `strategy: "tool-forced"` constrains the shape at generation on providers that declare the capability. |
| 41 | [`41-local-model.ts`](features/41-local-model.ts) | Local model — the free middle rung of the adapter ladder | ollama('<model>') runs a real model on your laptop: no API key, no cost, no vendor SDK. Same agent code as mock() and as anthropic() — this example runs one agent on all three rungs. Refusals name the fix (`ollama serve`, `ollama pull <model>`). |
| 42 | [`42-skill-graph-model-pick.ts`](features/42-skill-graph-model-pick.ts) | Skill graph — the model picks, and the pick takes effect | When no entry rule matches, the model picks a skill from the read_skill menu and the pick moves the graph's cursor — the skill's body and tools load on the next iteration, and the graph's declared steps run from there. A declared edge still outranks a same-turn pick. |
| 43 | [`43-skill-graph-tree-pick.ts`](features/43-skill-graph-tree-pick.ts) | Skill graph — a tree routes by predicate, and read_skill cannot jump it | A decision tree() has no cursor, so read_skill has nothing to move: a leaf pick is refused with a message explaining the tree, instead of being accepted and silently dropped. Skills registered beside the tree stay reachable, because those really do activate by read_skill. |
| 44 | [`44-skill-graph-read-skill-offer.ts`](features/44-skill-graph-read-skill-offer.ts) | Skill graph — read_skill offers only what the gate will grant | read_skill's menu is rebuilt each iteration from the same reachability the gate enforces, so the model is never offered a skill it will be refused. The enum stays the full catalog on purpose — narrowing it would route out-of-reach picks into a schema error and silently retire the gate's teaching refusal. |
| 45 | [`45-credential-consent.ts`](features/45-credential-consent.ts) | Credentials — 3LO consent pauses the run instead of asking the model | A declared credential comes back authorization-required. The run PAUSES and the caller receives the consent URL on the pause outcome; the model is never told, because it cannot click a link. After consent, resume() re-resolves the credential and runs the tool that was waiting — same run, work actually done. The URL is a bearer capability and appears in no snapshot, narrative, event or recording. |
| 46 | [`46-skill-graph-checkup-deepens.ts`](features/46-skill-graph-checkup-deepens.ts) | Skill graph — the check-up learns about entries, bare edges and baseline tools | Three new check-up codes (multi-entry-fanout, dead-entry-step, model-edge-only), an unreachable-skill message told per trigger kind, checkup({ knownTools }) so a baseline .tool() stops reading as a typo, and the fluent .build() default moving to `throw` so a graph that cannot start no longer builds in silence. Every new code is a WARNING — each names something a read_skill pick can still reach. |
| 47 | [`47-skills-from-dir-graph.ts`](features/47-skills-from-dir-graph.ts) | Skills authored as files — skillsFromDir into a skill graph | What a SKILL.md can and cannot carry (name + description + body — no tools, no autoActivate, no per-file surfaceMode), and the pattern that limit points at: load the prose-shaped skills from disk, define the tool-carrying ones in code, hand the mixed list to skillGraph({ skills }). |
| 48 | [`48-graceful-shutdown.ts`](features/48-graceful-shutdown.ts) | Graceful shutdown — the last batch is not lost | A batching exporter loses its buffer when a process exits. `telemetry.flush()`, `agent.shutdown()` and `flushOn: "run-end"` are the three doors that stop that happening. |
| 49 | [`49-self-explain-live.ts`](features/49-self-explain-live.ts) | Self-explaining agent — "why did you skip the refund?" answered from the record | One .selfExplain() call lets an agent answer a why-question about its OWN previous turn by walking the recorded evidence of that turn with trace tools (find_in_trace → inspect_tool_call → run_overview). Nothing re-executes: the per-tool run counters are printed either side of the explanation and are unchanged, and the refund it decided against is never issued. |
| 50 | [`50-through-the-tool-boundary.ts`](features/50-through-the-tool-boundary.ts) | Through the tool boundary — the agent explains what happened INSIDE its tool | A weather-advice agent whose ONE tool is a footprintjs flowchart wrapped with flowchartAsTool({ keepRecord: true }). Asked "why did you say it will rain?", it descends past the tool boundary with inspect_tool_call to inspect_tool_run and cites the inner stage and the exact field that drove the decision — while the chart stage counters printed either side prove nothing re-executed. |
| 51 | [`51-conversations.ts`](features/51-conversations.ts) | Conversations — run() is one turn, followUp() is the next one | agent.run() is a single turn and starts a new conversation every time; agent.followUp(message) and run({ message, continueFrom }) are the doors that continue one. The example prints the messages the provider actually received for all three, shows that identity.conversationId is a namespace key rather than a session, and demonstrates the two refusals that replaced silent corruption. |

### [`canonical/`](canonical/) — end-to-end patterns

| # | File | Title | Description |
|---|---|---|---|
| — | [`loan-officer-causal.ts`](canonical/loan-officer-causal.ts) | Canonical: Loan officer with causal-memory cross-run replay | Monday: expensive model underwrites loan #42 (REJECT). Friday: cheap model answers  |

### [`deploy/`](deploy/) — examples

| # | File | Title | Description |
|---|---|---|---|
| — | [`agentcore-runtime.ts`](deploy/agentcore-runtime.ts) | Deploy on AWS Bedrock AgentCore Runtime (/invocations + /ping) | Run an agentfootprint agent inside AgentCore Runtime with agentCoreRuntimeHost + agentCoreSessions: the container HTTP contract (POST /invocations, GET /ping on :8080) and the session header, as adapters on the hosting ports. Self-tests the contract, then exits; AGENTCORE_SERVE=1 listens forever. |
| — | [`durable-sessions.ts`](deploy/durable-sessions.ts) | Durable sessions — a crash-survivable run, and a pause that persists | standingAgent({ durability: 'sync' }) makes progress crash-survivable one iteration at a time, and a run that stops to ask a person is stored as 'flowchart-v1' and answered by a later request carrying a decision (202 → 200 over HTTP). |
| — | [`echo-conversation.ts`](deploy/echo-conversation.ts) | A door that stays open — serveConversations() beside serve() | The conversation port: a session-scoped two-way channel for callers that dial out instead of being called. One socket serves /invoke and the conversation door together; the ceilings are declared rather than hidden behind auto-chunking; a frame past the cap and a send on a closed channel each refuse by name; onClose says who ended it. |
| — | [`one-port.ts`](deploy/one-port.ts) | One port, two protocols — the agent attached to a server you own | Serve the agent AND a WebSocket upgrade on a single port: create the node:http server yourself, add your upgrade listener, and hand it to nodeHost({ server }). The host attaches its two routes, never 404s your paths, and close() detaches without closing your socket. |
| — | [`own-routes.ts`](deploy/own-routes.ts) | Your own routes on the agent’s port — onUnhandled | Serve a diagnostic route beside the agent on ONE port without binding the socket yourself: nodeHost({ onUnhandled }) hands every path the host does not own to your code instead of answering 404 for your application. /invoke, /health and /conversation never reach it, and a route that throws costs that request a 500 and nothing else. |
| — | [`sqlite-sessions.ts`](deploy/sqlite-sessions.ts) | SQLite sessions — a conversation, and a paused run, that survive a restart | sqliteSessions({ file }) is the SessionLifecycle port backed by Node\'s built-in node:sqlite: conversations and runs paused waiting on a person live in one file, so a restart or a deploy does not lose them. Zero dependencies; one machine, one file, one writer at a time. |
| — | [`standing-agent.ts`](deploy/standing-agent.ts) | A standing agent — hosted, and remembering between requests | Serve one agent over HTTP with per-session conversation memory: standingAgent + nodeHost + memorySessions. Has a two-turn conversation against itself, proves turn 2 remembered turn 1, then exits. SERVE=1 listens forever. |

### [`dynamic-react/`](dynamic-react/) — examples

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-classic-react.ts`](dynamic-react/01-classic-react.ts) | Classic ReAct — every tool on every iteration | All 12 tools registered up front. Every LLM call ships every  |
| 02 | [`02-dynamic-react.ts`](dynamic-react/02-dynamic-react.ts) | Dynamic ReAct — tools narrow via autoActivate skills | Same 12 tools as 01-classic-react.ts, but behind 3 skills with  |

### [`observability/`](observability/) — examples

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-trace-debug-session.ts`](observability/01-trace-debug-session.ts) | Trace debug session — the introspection toolpack (RFC-003 Part C) | A planted wrong value (DTI computed against annual income) flows through a decide()  |
| 02 | [`02-lint-confusable-catalog.ts`](observability/02-lint-confusable-catalog.ts) | Tool-catalog confusability lint — the Neo twins (RFC-002 C1/C2) | analyzeToolCatalog lints a real 16-tool SAN catalog (zero stack buy-in: plain  |
| 03 | [`03-lint-fix-and-pass.ts`](observability/03-lint-fix-and-pass.ts) | Lint → fix descriptions → gate passes (RFC-002 C3) | The remediation loop: a 3-tool catalog fails the lint (confusable fcns twins, missing  |
| 04 | [`04-tool-choice-margins.ts`](observability/04-tool-choice-margins.ts) | Runtime tool-choice margins + flags (RFC-002 C4–C6) | toolChoiceRecorder watches a scripted agent walk into the Neo fcns-twin trap: per LLM  |
| 05 | [`05-context-bisect.ts`](observability/05-context-bisect.ts) | Context bisect — the contextual-bug localizer (RFC-003 Part B) | A planted misleading FACT injection makes a refunds agent approve a 47-day-old refund;  |
| 06 | [`06-backtrack-trace.ts`](observability/06-backtrack-trace.ts) | toBacktrackTrace — serialize a localizer report for the why-board UI | Serializes the example-05 causal localizer report into the BacktrackTrace contract that  |
| 07 | [`07-trace-debug-agent.ts`](observability/07-trace-debug-agent.ts) | traceDebugAgent — the dedicated conversational trace debugger | One call turns a completed run into a debuggable conversation: traceDebugAgent() returns  |
| 08 | [`08-self-explain.ts`](observability/08-self-explain.ts) | .selfExplain() — in-conversation why-questions over the agent’s own trace | One builder call lets the main agent answer follow-up why-questions from its own previous  |
| 09 | [`09-attributability-marker.ts`](observability/09-attributability-marker.ts) | rankingConfidence — honesty marker on influence rankings | When no source clearly dominates an influence ranking (the signature of an  |
| 10 | [`10-missing-context.ts`](observability/10-missing-context.ts) | _no meta_ | — |
| 11 | [`11-contrastive-influence.ts`](observability/11-contrastive-influence.ts) | scoreContrastiveInfluence — cancel the topical-innocent confound | Output-similarity influence is fooled by a topically-central innocent (the  |
| 12 | [`12-two-score-localization.ts`](observability/12-two-score-localization.ts) | two-score localization — quality + cost from one ablation | One ablation re-run, two independent scores: QUALITY (answer flipped?) and COST  |
| 13 | [`13-context-error-finders.ts`](observability/13-context-error-finders.ts) | _no meta_ | — |
| 13 | [`13-per-loop-trajectory.ts`](observability/13-per-loop-trajectory.ts) | per-loop trajectory — one frame per ReAct iteration | assembleTrajectory slices a flat-agent run into LoopFrames (one per iteration) from  |
| 14 | [`14-loop-recall-shortlist.ts`](observability/14-loop-recall-shortlist.ts) | per-loop recall shortlist — rescue early culprits before ablation | shortlistEarlyCulprits aggregates per-loop influence with a recency weight so a culprit that  |
| 15 | [`15-walk-to-root.ts`](observability/15-walk-to-root.ts) | walk to root — narrow → hop → convict, symptom to root | walkToRoot walks a decision bug backward (per-loop narrow → writerId provenance hop → run-wide  |
| 16 | [`16-pluggable-scorer.ts`](observability/16-pluggable-scorer.ts) | Pluggable influence scorer — swap the RANK stage, never causality | localizeContextBug({ scorer }) makes the suspect-ranking scorer a swappable slot. The default  |
| 17 | [`17-localize-quickstart.ts`](observability/17-localize-quickstart.ts) | Localize a context bug — quickstart (BETA) | The smallest end-to-end localizeContextBug run: a planted misleading fact makes a refunds  |
| 18 | [`18-influence-strategies-and-rerun.ts`](observability/18-influence-strategies-and-rerun.ts) | Influence strategies + rerunWithoutSources — the Influence Map loop | A stock-desk agent answers BUY driven by planted social sentiment. listInfluenceStrategies()  |
| 19 | [`19-recorded-chat.ts`](observability/19-recorded-chat.ts) | recordedChat — a chat session that can explain itself | A three-turn financial-advisor chat recorded turn-by-turn. Every send() freezes that turn\'s  |
| 20 | [`20-record-and-render.ts`](observability/20-record-and-render.ts) | Record a run, save it, render it in both UIs | recordRun() saves a run as the three fields a viewer needs — snapshot, events, structure —  |
| 21 | [`21-variable-recall.ts`](observability/21-variable-recall.ts) | Variable recall — a variable’s recorded life, and a walk that stops guessing | traceVariable joins footprintjs keyTimeline/forwardSliceForKey to agent vocabulary (loops,  |

### [`rag/`](rag/) — examples

| # | File | Title | Description |
|---|---|---|---|
| 01 | [`01-folder-to-agent.ts`](rag/01-folder-to-agent.ts) | A folder of documents becomes an answering agent | indexFolder over three real documents (two Markdown, one 2-page PDF),  |

<!-- AUTO-GENERATED:examples:end -->
