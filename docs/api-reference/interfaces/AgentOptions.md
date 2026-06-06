[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentOptions

# Interface: AgentOptions

Defined in: [src/core/agent/types.ts:29](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L29)

## Properties

### cacheStrategy?

> `readonly` `optional` **cacheStrategy?**: `CacheStrategy`

Defined in: [src/core/agent/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L79)

Optional explicit CacheStrategy override (v2.6+). Defaults to
`getDefaultCacheStrategy(provider.name)` — so Anthropic/OpenAI/
Bedrock/Mock providers auto-resolve to their respective strategies
once those land in Phase 7+.

***

### caching?

> `readonly` `optional` **caching?**: `"off"`

Defined in: [src/core/agent/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L72)

Global cache kill switch (v2.6+). `'off'` disables the cache
layer entirely — the CacheGate decider routes to `'no-markers'`
every iteration regardless of other rules. Default: caching
enabled (auto-resolved per provider via the strategy registry).

Use `'off'` for low-frequency agents (cron jobs running once per
hour) where the cache TTL guarantees zero cache hits and the
cache-write penalty isn't worth paying.

***

### costBudget?

> `readonly` `optional` **costBudget?**: `number`

Defined in: [src/core/agent/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L52)

Cumulative USD budget per run. With `pricingTable`, Agent emits a
one-shot `agentfootprint.cost.limit_hit` (`action: 'warn'`) when
cumulative USD crosses this budget. Execution continues — consumers
choose whether to abort by listening to the event.

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core/agent/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L106)

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

Defined in: [src/core/agent/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L34)

Stable id used for topology + events. Default: 'agent'.

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [src/core/agent/types.ts:39](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L39)

Hard budget on ReAct iterations. Default: 10. Hard cap: 50.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/agent/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L37)

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L35)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/agent/types.ts:32](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L32)

Human-friendly name shown in events/metrics. Default: 'Agent'.

***

### permissionChecker?

> `readonly` `optional` **permissionChecker?**: [`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md)

Defined in: [src/core/agent/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L61)

Permission adapter. When set, the Agent calls
`permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
`tool.execute()`. Emits `agentfootprint.permission.check` with the
decision. On `deny`, the tool is skipped and its result is a
synthetic denial string; on `allow` / `gate_open`, execution proceeds
normally.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [src/core/agent/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L45)

Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
after every LLM response (once per ReAct iteration) with per-call
and cumulative USD. Run-scoped — the cumulative resets each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/agent/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L30)

***

### reactMode?

> `readonly` `optional` **reactMode?**: `"classic"` \| `"dynamic"` \| `"dynamic-grouped"`

Defined in: [src/core/agent/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L137)

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

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/agent/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L96)

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

Defined in: [src/core/agent/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/core/agent/types.ts#L36)
