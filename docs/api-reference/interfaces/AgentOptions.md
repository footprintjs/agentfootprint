[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentOptions

# Interface: AgentOptions

Defined in: [src/core/agent/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L136)

## Properties

### artifacts?

> `readonly` `optional` **artifacts?**: [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md) \| [`AgentArtifactsOptions`](/agentfootprint/api/generated/interfaces/AgentArtifactsOptions.md)

Defined in: [src/core/agent/types.ts:400](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L400)

The artifact store (9.21.0) — the claim-check seam. When set, every tool's
`ctx.artifacts` is this store bound to the RUN's scope (the same
tenant/principal/conversation tuple memory scopes on, composed by the
framework — a tool can never name or widen it), and every mint / resolve /
sweep / refusal lands on the typed record as
`agentfootprint.artifacts.*`. From the main barrel:
`inMemoryArtifacts()`, `fileArtifacts({ directory })`,
`sqliteArtifacts({ file })` — or any `ArtifactStore`.

Since 9.22.0 the store also switches on the data legs: tools may declare
`wants` (ref arguments resolved at dispatch), the `present` tool is
auto-attached, and — via the object form — the operator may set the
placement threshold: `artifacts: { store, placement: { maxInlineChars } }`
checks any tool result over the threshold into the store and hands the
model the claim ticket instead ([AgentArtifactsOptions](/agentfootprint/api/generated/interfaces/AgentArtifactsOptions.md)). The bare
`ArtifactStore` form stays exactly what it was: the store, no placement.

Unset — the default — the agent is byte-identical to earlier releases:
no events, no state, no `present` tool, and `ctx.artifacts` is a
fail-closed capability whose every method throws a teaching refusal
naming this option (`ctx.hasArtifacts` is the fact to branch on).

***

### cacheStrategy?

> `readonly` `optional` **cacheStrategy?**: `CacheStrategy`

Defined in: [src/core/agent/types.ts:555](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L555)

Optional explicit CacheStrategy override (v2.6+). Defaults to
`getDefaultCacheStrategy(provider.name)` — so Anthropic/OpenAI/
Bedrock/Mock providers auto-resolve to their respective strategies
once those land in Phase 7+.

***

### caching?

> `readonly` `optional` **caching?**: `"off"`

Defined in: [src/core/agent/types.ts:548](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L548)

Global cache kill switch (v2.6+). `'off'` disables the cache
layer entirely — the CacheGate decider routes to `'no-markers'`
every iteration regardless of other rules. Default: caching
enabled (auto-resolved per provider via the strategy registry).

Use `'off'` for low-frequency agents (cron jobs running once per
hour) where the cache TTL guarantees zero cache hits and the
cache-write penalty isn't worth paying.

***

### commitValues?

> `readonly` `optional` **commitValues?**: `CommitValuesMode`

Defined in: [src/core/agent/types.ts:326](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L326)

Commit-log value encoding (#13c-B) — forwarded to the internal
executor as `{ commitValues }`. Agent default is **`'delta'`**: a
stage whose net change to a tracked array is "the old array plus a
tail" (the agent's `history` every iteration) records ONLY the tail
(`append` verb); key removals record a `delete` verb. LOSSLESS — any
step's full value reconstructs by replay (`commitValueAt` from
`footprintjs/trace`), which is why this is safe for audit trails.
Retained commit-log memory becomes linear instead of quadratic.
Set `'full'` for footprintjs's default encoding (every changed key
stores its full final value) if a downstream consumer reads
`bundle.overwrite[key]` as the complete value.

***

### contextBudget?

> `readonly` `optional` **contextBudget?**: `object`

Defined in: [src/core/agent/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L205)

Per-slot context budgets, in characters (8.11.0).

Each of the three context slots warns — and emits
`agentfootprint.context.budget_pressure` — when what it composed for an
iteration exceeds its budget. **Nothing is ever truncated:** the full
content still reaches the LLM. The budget is a signal that the slot is
growing past what you expected, not a limiter.

Defaults: `systemPrompt` 4000, `messages` 10000, `tools` 2000. The keys
are the three slots the context model already names
(`ContextSlot = 'system-prompt' | 'messages' | 'tools'`), so the option
and the event it produces speak one vocabulary.

Before 8.11.0 these caps existed but no public door reached them, and the
over-budget warning told you to "raise budgetCap" — a knob nothing could
set. Raising a budget is the right answer when the slot is legitimately
that big (a long conversation easily passes the 10000-character messages
default); trimming is the right answer when it isn't.

#### messages?

> `readonly` `optional` **messages?**: `number`

#### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `number`

#### tools?

> `readonly` `optional` **tools?**: `number`

#### Example

```ts
Give a long-running support agent more room for history
  Agent.create({ provider, model, contextBudget: { messages: 40_000 } })
```

***

### costBudget?

> `readonly` `optional` **costBudget?**: `number` \| \{ `onExceed`: `"warn"` \| `"halt"`; `usd`: `number`; \}

Defined in: [src/core/agent/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L181)

Cumulative USD cap for one run. Requires a `pricingTable` — the budget is
money and only a pricing table turns tokens into money (refused at build
otherwise since 8.13.0).

A bare number WARNS: `agentfootprint.cost.limit_hit` fires once with
`action: 'warn'` and the run carries on. That is what this option has
always done, and it stays exactly that.

`{ usd, onExceed: 'halt' }` makes it a stop. The loop ends at the next
iteration boundary — the same boundary `maxIterations` uses — so a call
already in flight completes, is billed and is recorded; nothing is
abandoned mid-request. The run returns the answer it has (possibly `''`)
and `agent.stoppedEarly()` says why.

#### Example

```ts
Agent.create({ provider, model, pricingTable, costBudget: 0.50 })           // warns
Agent.create({ provider, model, pricingTable,
               costBudget: { usd: 0.50, onExceed: 'halt' } })               // stops
```

***

### credentials?

> `readonly` `optional` **credentials?**: `CredentialProvider`

Defined in: [src/core/agent/types.ts:376](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L376)

Credential provider for downstream OAuth (declare-and-push). When set, a
tool that declares `needs: { credential }` has it resolved BEFORE `execute`
and injected as `ctx.credential`; tools can also pull via `ctx.credentials`.
From `agentfootprint/security` (`agentCoreIdentity({ region })`,
`staticTokens({ ... })`, or any `CredentialProvider`).

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core/agent/types.ts:582](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L582)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `agent.getUIGroup()` invokes
it with the Agent's `GroupMetadata` (kind `'Agent'`, id, name,
empty `members[]`, plus `extra.slots` and `extra.toolNames`).
Tools are not `Runner` instances (they're function executors)
so they're conveyed by name in `extra`, not as group members.
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core/agent/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L141)

Stable id used for topology + events. Default: 'agent'.

***

### keepLastToolResults?

> `readonly` `optional` **keepLastToolResults?**: `number` \| `false`

Defined in: [src/core/agent/types.ts:467](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L467)

How many tools' most recent results the window keeps beyond
`keepRecentTurns` (9.57.0). **On by default, at 2.** Only meaningful
beside `.window(...)` / `.compaction(...)`; an agent with no window
strategy never builds the stage and pays nothing either way.

The failure it addresses is measured, not imagined. An agent drove a
screen through tools; one tool result carried the only list of valid ids.
Under a small window that result left after about two iterations — while
the 9.55.0 anchor kept the REQUEST, so the model still knew what it had
been asked to do and no longer had what it needed to do it. It assembled
a plausible id out of an entity name it remembered, was refused, and
spent actions on it. In one archived run the final answer to the person
named a host that appears in no tool result at all.

So for each tool that has spoken since the request, the window keeps that
tool's MOST RECENT result — at most this many beyond the recent-turns
window — until the agent calls that tool again or the person asks
something new. One pin per tool name, superseded on the next call, so it
cannot accumulate past your tool roster; a parallel batch is one turn and
costs one slot; and a pin that has provably blocked two consecutive
boundaries stands down ON THE RECORD rather than let a window grow.

What it costs, and how to see it: `WindowRecord.observations` names every
turn the pin held and its exact character count, so the window's size
without the pin is computable from the record. What it gets wrong is
documented rather than buried — the pin is CONTENT-BLIND (a tool's last
result may be a one-word acknowledgement while the load-bearing one was
the call before), and under `summarizeOldest` a pinned turn stays raw
while everything around it is folded.

Set `false` (or `0`) to switch it off — no pins, no `observations` key,
and the window behaves exactly as it did in 9.56.0.

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [src/core/agent/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L146)

Hard budget on ReAct iterations. Default: 10. Hard cap: 50.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/agent/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L144)

***

### maxToolResultChars?

> `readonly` `optional` **maxToolResultChars?**: `number`

Defined in: [src/core/agent/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L272)

The ceiling on ONE tool result, in characters (9.11.0). **Opt-in — there
is no default, and there will not be one.**

Over the cap, the result is REPLACED by a marker that names the tool, the
size, the cap, and the one action that helps — and carries the first
characters of the real answer verbatim:

```json
{ "truncated": true,
  "reason": "orders_export returned 812431 chars, over the 20000-char cap. Narrow the request and call again.",
  "head": "id,customer,total\n1001,…" }
```

The marker IS the result. It is what the model reads on the `role: 'tool'`
message AND what `agentfootprint.stream.tool_end` carries — so a run that
capped a 800KB result does not then ship that same 800KB to an event sink,
and a trace shows the truncation instead of hiding it. `head` gets whatever
the cap has left after the sentence explaining it, so a bigger cap buys a
proportionally bigger head.

**Why no default.** A default would silently modify tool results: a tool
that returns 200KB of rows is doing what somebody wrote it to do, and a
framework that quietly replaced that the first time it ran would be lying
to the app about its own tool. Omitted, results are never measured and
never replaced — byte-identical to every earlier release.

It composes with, and never replaces, what a tool already does: a tool with
its own paging keeps it, `CodeResult.truncated` still means what it means,
and an `onToolResult` middleware that summarizes runs FIRST — the cap
measures what the chain produced. It is the last-resort net, not the plan.
When big tool DATA is the norm rather than the accident, the answer is the
`CodeRunner` port ("summarize prose, compute data"), not a bigger cap.

Refused at construction for a non-positive or non-integer value: `0` is not
"off" — omitting the option is.

#### Example

```ts
a support agent whose search tool can return a whole knowledge base
  Agent.create({ provider, model, maxToolResultChars: 20_000 })
```

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L142)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/agent/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L139)

Human-friendly name shown in events/metrics. Default: 'Agent'.

***

### observerDelivery?

> `readonly` `optional` **observerDelivery?**: `"inline"` \| `"deferred"`

Defined in: [src/core/agent/types.ts:643](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L643)

Observer delivery tier (RFC-001 Block 10). Default `'inline'` —
byte-identical to every prior release: the Agent's bridge recorders
(and your `.watch()` attachments) run synchronously inside the
producing statement, so a slow `agent.on()` listener taxes every
stage of every iteration.

`'deferred'` moves observation off the hot path: every observer event
is captured into footprintjs's bounded queue (≈ microseconds) and
delivered at the next microtask checkpoint — "one beat behind", with
listener work overlapping the LLM/tool await windows instead of
serializing with the loop. Same events, same payloads, same order;
only the timing meta (`wallClockMs` / `runOffsetMs`) reflects the
later delivery. Terminal boundaries (run resolve, reject, pause)
drain the queue synchronously BEFORE control returns, so crash
reports / checkpoints always carry the complete record.

Exception kept inline for correctness: the causal-evidence harvest
recorder (mounted with CAUSAL memories) — the memory write stage
reads its accumulators MID-run, so it cannot run one beat behind.

Per-recorder override: a consumer recorder that declares its own
`delivery` field keeps it — the agent-level option is the default
tier for recorders that don't declare one.

For serverless / graceful shutdown, settle async listener work with
`await agent.drainObservers({ timeoutMs })` before the process exits.
Queue stats surface on `agent.getLastSnapshot()?.observerStats`.

***

### observerDeliveryOptions?

> `readonly` `optional` **observerDeliveryOptions?**: [`ObserverDeliveryOptions`](/agentfootprint/api/generated/type-aliases/ObserverDeliveryOptions.md)

Defined in: [src/core/agent/types.ts:649](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L649)

Queue dials for `observerDelivery: 'deferred'` — see
`ObserverDeliveryOptions`. Throws at construction when set without
`observerDelivery: 'deferred'` (no silently-ignored combinations).

***

### onAuthorizationRequired?

> `readonly` `optional` **onAuthorizationRequired?**: `AuthorizationRequiredMode`

Defined in: [src/core/agent/types.ts:537](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L537)

What the run does when a tool's DECLARED credential (`needs: { credential }`)
comes back `authorization-required` — a person has to click a consent link
before the tool can run. Default **`'pause'`** (8.6.0).

- `'pause'` — the run stops at the block. `agent.run()` returns a pause
  outcome whose `pauseData.authorization` carries `{ service, sessionId,
  authorizationUrl }`; a `standingAgent` answers **202** with
  `{ awaiting }`; `agent.resume(checkpoint)` re-resolves the credential and
  runs the tool that was waiting. The model is never told, so it cannot
  adapt around work that has not happened.
- `'tell-model'` — the model reads a refusal naming the service (never the
  URL) and may route around the block. The turn still cannot report a clean
  completion: `agent.run()` raises `CredentialConsentRequiredError`, which
  carries the URL to the caller.

In BOTH modes the authorization URL stays out of the conversation, the
snapshot, the narrative, the typed event stream and any recording. It is a
bearer capability carrying a session-correlating `state` parameter; before
8.6.0 it was interpolated into the tool result and copied into all of them.

***

### permissionChecker?

> `readonly` `optional` **permissionChecker?**: [`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md)

Defined in: [src/core/agent/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L218)

Permission adapter. When set, the Agent calls
`permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
`tool.execute()`. Emits `agentfootprint.permission.check` with the
decision. On `deny`, the tool is skipped and its result is a
synthetic denial string; on `allow` / `gate_open`, execution proceeds
normally.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [src/core/agent/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L152)

Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
after every LLM response (once per ReAct iteration) with per-call
and cumulative USD. Run-scoped — the cumulative resets each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L137)

***

### reactMode?

> `readonly` `optional` **reactMode?**: `"classic"` \| `"dynamic"` \| `"dynamic-grouped"`

Defined in: [src/core/agent/types.ts:613](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L613)

How the ReAct loop behaves — a single setting with three honest choices.
Default `'dynamic'`. (Merged in 6.0.0 from the old `reactMode` +
`reactStructure` pair, which had a silently-ignored combination.)

`'dynamic'` (default) — every iteration re-runs the InjectionEngine and
all three slots (system-prompt ‖ messages ‖ tools), because which
injections are active can change per turn (a skill activates, a rule
fires, a tool-return triggers something). The right shape when the agent
uses skills, rule/on-tool-return triggers, or any per-turn context
steering. Flat chart shape.

`'classic'` — textbook ReAct: context is engineered ONCE. The
InjectionEngine, system-prompt and tools run a single time up front; the
loop targets only the Messages slot, so each iteration just appends the
new tool result and re-calls the LLM. Use when the system prompt and tool
set are FIXED for the whole run (the common case). Flat chart shape — the
chart reads honestly: `ToolCalls → Messages` loops, static slots outside.
CAVEAT: because static slots are cached after turn 1, do NOT use `'classic'`
with skills or dynamic-trigger injections — a mid-run activation would not
surface into the cached system-prompt/tools. Use `'dynamic'` for those.

`'dynamic-grouped'` — same semantics as `'dynamic'`, but the whole LLM turn
(injection engine + 3 slots + cache + call + thinking) is wrapped in a
single `sf-llm-call` SUBFLOW — the same boundary the `LLMCall` primitive
produces. Lens (and any explainable-ui consumer) renders it as an LLM group
with its slots inside, with zero bespoke collapsing. Behaviour is identical
to `'dynamic'`; only the chart's nesting differs. (Grouping is dynamic-only:
it re-seeds context every turn by design, so there is no classic-grouped.)

***

### readTracking?

> `readonly` `optional` **readTracking?**: `RetentionPolicy`

Defined in: [src/core/agent/types.ts:312](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L312)

Read-tracking policy for the snapshot's per-stage read view
(footprintjs `StageSnapshot.stageReads`) — the observability-cost
lever for LONG runs. Forwarded to the Agent's internal
`FlowChartExecutor` as `{ readTracking }`.

- `'summary'` (Agent default) — each tracked read records a cheap
  `ReadSummaryMarker` (type + size proxy + short preview) instead of
  a `structuredClone` of the value. Measured at N=200 full-feature
  iterations, `'full'` clones ~18MB of read values that nothing in
  the agentfootprint/lens/explainable-ui stack consumes.
- `'full'` — footprintjs's own default: every tracked read clones the
  value into `stageReads`. Set explicitly if you inspect
  `agent.getSnapshot()` read VALUES (not just keys/shapes).
- `'off'` — reads are not recorded; `stageReads` is absent.

Narrative, recorder events (`onRead` payloads), and commit history are
IDENTICAL in every mode — the policy scopes ONLY the snapshot's
`stageReads` payload. Note the Agent default (`'summary'`) is
deliberately cheaper than footprintjs's (`'full'`); see CHANGELOG
behavior-change callout.

***

### recordSystemPrompt?

> `readonly` `optional` **recordSystemPrompt?**: `boolean`

Defined in: [src/core/agent/types.ts:368](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L368)

Record the ASSEMBLED system prompt on every LLM call (9.50.0).
**Opt-in. Default OFF — and the default is a privacy decision.**

When `true`, each `agentfootprint.stream.llm_start` event carries
`systemPromptText`: the joined injection pieces verbatim, exactly as the
provider received them. That is the string today's recordings only
describe (each piece is on the record; the assembled whole is not), so a
debugger no longer has to render "not in this recording" for the one
artifact the model actually read.

WHY OFF BY DEFAULT: the assembled prompt is as sensitive as everything
in it — skill bodies, RAG passages, memory recalls, per-user
instructions — and it can be LARGE, once per iteration. With the dial on,
it rides into every attached recorder, every vendor sink, every
`recordRun` recording and every persisted envelope; treat those artifacts
accordingly. Off (the default), `llm_start` keeps its exact prior bytes —
`systemPromptChars` still reports the length, and the text is honestly
absent rather than summarized.

#### Example

```ts
capture the prompt while debugging context assembly
  Agent.create({ provider, model, recordSystemPrompt: true })
```

***

### repeatedCallNudge?

> `readonly` `optional` **repeatedCallNudge?**: `boolean`

Defined in: [src/core/agent/types.ts:432](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L432)

Tell the model when it has already made this exact call and already got
this exact answer (9.26.0). **On by default.**

When one tool is dispatched with deeply-equal arguments and returns a
byte-identical result for the second time in a turn, one sentence is
appended to that result: *identical call, identical result — calling again
will not change it.* The call still RAN, the result is unchanged beside
the note, and a third identical call is not blocked. It is evidence, not a
gate.

The failure it addresses is measured rather than imagined: a traced run in
which a model called one tool three times with identical arguments after
the backend silently ignored a filter, reading the same rows as a fresh
answer each time. Nothing inside the conversation can see that; the
framework watched all three land.

**A turn that repeats nothing is byte-identical either way** — the same
results, the same events, and the same tracked state down to the key set.
The counters are held run-keyed beside the dispatch loop, never written to
scope: a within-turn tally is not conversation state, and tracked state is
the commit log, the snapshot, the narrative and every recording. Only an
actual repeat is visible, as one sentence on that result and one
`agentfootprint.tools.repeated_call` event.

Set `false` to switch it off — nothing is fingerprinted, no counter is
kept, and even a repeating turn is byte-identical to earlier releases.
Worth doing when a deployment's tools are deliberately polled (an identical
call returning an identical status IS the expected shape while a job runs)
and the note would be noise rather than news.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/agent/types.ts:572](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L572)

Optional build-time recorders threaded into footprintjs's
`flowChart()` factory. Each recorder fires `onStageAdded` once per
node in the Agent's internal chart (Seed, CallLLM, Route, tool
handler, slot mounts, PrepareFinal, BreakFinal), and
`onSubflowMounted` once per mounted subflow. Recorders own their
own accumulators — agentfootprint just threads them through.

Cascade: each slot subflow (system-prompt, messages, tools)
was built earlier with its OWN recorders (or none).
footprintjs does NOT propagate StructureRecorders into mounted
subflows — attach the same recorders to every nested composition
for full coverage.

When omitted, no build-time observation is wired up.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/core/agent/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L143)

***

### toolArgValidation?

> `readonly` `optional` **toolArgValidation?**: [`ToolArgValidationMode`](/agentfootprint/api/generated/type-aliases/ToolArgValidationMode.md)

Defined in: [src/core/agent/types.ts:231](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L231)

Tool-args validation mode (#9). Default `'enforce'`: LLM-produced args
are validated against the tool's declared `inputSchema` BEFORE dispatch.
On mismatch the tool is NOT executed — the model receives a structured
retry message as the tool result (paths + expected shapes + received
TYPES, never the supplied values) and corrects itself on the next
iteration. Emits `agentfootprint.validation.args_invalid`.
`'warn'` emits the event but executes anyway; `'off'` disables.
Validation is an honest JSON-Schema subset (type/required/properties/
items/enum/explicit additionalProperties:false) — unsupported keywords
are ignored, never false-rejecting.

***

### toolTeardownTimeoutMs?

> `readonly` `optional` **toolTeardownTimeoutMs?**: `number`

Defined in: [src/core/agent/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L289)

How long ONE tool teardown may take before the runner stops waiting
(default 5000ms). See `ctx.onTeardown`.

Bounded because teardown sits on the SIGTERM path: an unbounded vendor
`Stop()` turns a container stop into a thirty-second wait for SIGKILL, and
a shutdown that hangs is indistinguishable from one that crashed. When the
budget runs out the cleanup is ABANDONED, not cancelled — there is nothing
to cancel a vendor's in-flight call with — and
`agentfootprint.tools.session_close_failed` fires with
`errorClass: 'ToolTeardownTimeoutError'`, because a session that may still
be live is a fact somebody is paying for.

Raise it for a backend whose `Stop` is genuinely slow; lower it for a
latency-critical shutdown where an abandoned session is the cheaper loss.

***

### wrapUpAtMaxIterations?

> `readonly` `optional` **wrapUpAtMaxIterations?**: `boolean`

Defined in: [src/core/agent/types.ts:515](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L515)

What a turn does when its ACTION BUDGET runs out mid-task (9.56.0).
Default **on**.

`maxIterations` is a cap on actions, and the model does not know it is
about to be hit. Before this, a turn that reached the cap while the model
was still asking for tools handed back whatever text happened to ride that
last call — which, mid-task, is a fragment: *"The third finding focus is
not settling… Let me check what's on screen now:"*. That sentence went to
the person as if it were the answer, and nothing on the record said the
budget had run out.

With this on, the run spends ONE more LLM call with **the tools withheld**
and this instruction appended, then hands back what comes back:

> *Your action budget for this turn is exhausted. Do not request tools.
> Give your best final answer from what you have: what you completed, what
> remains undone, and anything the person should know.*

That call is exempt from `maxIterations` by design — it cannot loop,
because with no tools on the wire there is nothing for the model to ask
for. It costs one call and it is on the record like any other turn (its
own `iteration_start` / `llm_start` / `cost.tick`).

It rides the ITERATION budget only. A halting `costBudget` keeps today's
behaviour, because there the person capped the MONEY and one more call
would spend past the cap; an action cap says nothing about a call that
takes no action.

The fact is on the record either way — `agent.stoppedEarly()` and
`agentfootprint.agent.budget_exhausted` both say whether the turn was
wrapped up (`action: 'wrapped-up'`) or cut short (`'cut-short'`), so a
dashboard can tell "answered" from "answered after the budget ran out".

**A turn that never runs out of budget is byte-identical either way** —
same calls, same events, same tracked state down to the key set.

Set `false` to keep the pre-9.56.0 behaviour: the turn ends on whatever
the last call produced. Worth doing when a caller renders `stoppedEarly`
itself and would rather not pay for the extra call.

#### Example

```ts
Agent.create({ provider, model, maxIterations: 8 });                     // wraps up
Agent.create({ provider, model, wrapUpAtMaxIterations: false });         // cuts short
```

***

### writeProvenance?

> `readonly` `optional` **writeProvenance?**: [`WriteProvenanceMode`](/agentfootprint/api/generated/type-aliases/WriteProvenanceMode.md)

Defined in: [src/core/agent/types.ts:344](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/types.ts#L344)

Per-write read provenance — forwarded to the internal executor as
`{ writeProvenance }`. Default **`'off'`** (footprintjs's own default):
every recording is byte-identical to earlier releases.

With `'reads-prefix'`, each recorded write also stores the keys that were
tracked-read BEFORE it, which upgrades what the trace layer can claim about
a value: a downstream write is linked to this value because that write's
own read-prefix names the key — and a write whose prefix omits it is
excluded exactly. That is the difference between "this stage read A and
wrote B, in some order the log cannot see" and a recorded dependency.

Turn it on when you intend to DEBUG the run: `traceVariable` reports
`coverage: 'exact'` only under this dial, and only then will `walkToRoot`
take a deterministic `narrowedBy: 'dataflow'` hop instead of an embedding
guess. Cost is one small array copy per write.
