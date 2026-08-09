[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentOptions

# Interface: AgentOptions

Defined in: [src/core/agent/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L61)

## Properties

### cacheStrategy?

> `readonly` `optional` **cacheStrategy?**: `CacheStrategy`

Defined in: [src/core/agent/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L259)

Optional explicit CacheStrategy override (v2.6+). Defaults to
`getDefaultCacheStrategy(provider.name)` — so Anthropic/OpenAI/
Bedrock/Mock providers auto-resolve to their respective strategies
once those land in Phase 7+.

***

### caching?

> `readonly` `optional` **caching?**: `"off"`

Defined in: [src/core/agent/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L252)

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

Defined in: [src/core/agent/types.ts:193](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L193)

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

Defined in: [src/core/agent/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L130)

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

Defined in: [src/core/agent/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L106)

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

Defined in: [src/core/agent/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L219)

Credential provider for downstream OAuth (declare-and-push). When set, a
tool that declares `needs: { credential }` has it resolved BEFORE `execute`
and injected as `ctx.credential`; tools can also pull via `ctx.credentials`.
From `agentfootprint/security` (`agentCoreIdentity({ region })`,
`staticTokens({ ... })`, or any `CredentialProvider`).

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core/agent/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L286)

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

Defined in: [src/core/agent/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L66)

Stable id used for topology + events. Default: 'agent'.

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [src/core/agent/types.ts:71](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L71)

Hard budget on ReAct iterations. Default: 10. Hard cap: 50.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/agent/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L69)

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L67)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/agent/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L64)

Human-friendly name shown in events/metrics. Default: 'Agent'.

***

### observerDelivery?

> `readonly` `optional` **observerDelivery?**: `"inline"` \| `"deferred"`

Defined in: [src/core/agent/types.ts:347](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L347)

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

Defined in: [src/core/agent/types.ts:353](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L353)

Queue dials for `observerDelivery: 'deferred'` — see
`ObserverDeliveryOptions`. Throws at construction when set without
`observerDelivery: 'deferred'` (no silently-ignored combinations).

***

### onAuthorizationRequired?

> `readonly` `optional` **onAuthorizationRequired?**: `AuthorizationRequiredMode`

Defined in: [src/core/agent/types.ts:241](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L241)

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

Defined in: [src/core/agent/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L143)

Permission adapter. When set, the Agent calls
`permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
`tool.execute()`. Emits `agentfootprint.permission.check` with the
decision. On `deny`, the tool is skipped and its result is a
synthetic denial string; on `allow` / `gate_open`, execution proceeds
normally.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [src/core/agent/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L77)

Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
after every LLM response (once per ReAct iteration) with per-call
and cumulative USD. Run-scoped — the cumulative resets each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L62)

***

### reactMode?

> `readonly` `optional` **reactMode?**: `"classic"` \| `"dynamic"` \| `"dynamic-grouped"`

Defined in: [src/core/agent/types.ts:317](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L317)

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

Defined in: [src/core/agent/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L179)

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

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/agent/types.ts:276](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L276)

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

Defined in: [src/core/agent/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L68)

***

### toolArgValidation?

> `readonly` `optional` **toolArgValidation?**: [`ToolArgValidationMode`](/agentfootprint/api/generated/type-aliases/ToolArgValidationMode.md)

Defined in: [src/core/agent/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L156)

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

### writeProvenance?

> `readonly` `optional` **writeProvenance?**: [`WriteProvenanceMode`](/agentfootprint/api/generated/type-aliases/WriteProvenanceMode.md)

Defined in: [src/core/agent/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L211)

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
