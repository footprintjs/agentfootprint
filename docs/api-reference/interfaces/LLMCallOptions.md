[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallOptions

# Interface: LLMCallOptions

Defined in: [src/core/LLMCall.ts:82](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L82)

## Properties

### contextBudget?

> `readonly` `optional` **contextBudget?**: `object`

Defined in: [src/core/LLMCall.ts:104](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L104)

Per-slot context budgets, in characters (8.11.0). The LLMCall twin of
`AgentOptions.contextBudget` — two slots here, since an LLMCall has no
tools slot.

Each slot warns (and emits `agentfootprint.context.budget_pressure`) when
it composes over its budget. **Nothing is truncated** — the full content
still reaches the LLM; the budget is a signal, not a limiter. Defaults:
`systemPrompt` 4000, `messages` 10000.

#### messages?

> `readonly` `optional` **messages?**: `number`

#### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `number`

***

### costBudget?

> `readonly` `optional` **costBudget?**: `number` \| \{ `onExceed`: `"warn"` \| `"halt"`; `usd`: `number`; \}

Defined in: [src/core/LLMCall.ts:125](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L125)

Cumulative USD budget per run. When provided along with `pricingTable`,
LLMCall emits `agentfootprint.cost.limit_hit` with `action: 'warn'`
the first time cumulative USD crosses the budget. Execution continues
— consumers choose whether to abort by listening to the event.

The object form `{ usd, onExceed }` is accepted for symmetry with `Agent`,
but `onExceed` must be `'warn'` here: halting means "stop at the next
iteration boundary", and one call has no next boundary. `'halt'` is
refused at build rather than silently ignored.

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core/LLMCall.ts:143](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L143)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the LLMCall's `GroupMetadata` (kind `'LLMCall'`, id, name,
empty `members[]`, plus `extra.slots` with the three slot ids —
`system-prompt`, `messages`, `tools` — so Lens can render the slot
cards inside an LLMCall card without inspecting `buildTimeStructure`).
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core/LLMCall.ts:87](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L87)

Stable id used for topology + events. Default: 'llm-call'.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/LLMCall.ts:93](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L93)

Optional max output tokens.

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/LLMCall.ts:89](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L89)

Model to request from the provider.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/LLMCall.ts:85](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L85)

Human-friendly name shown in events/metrics. Default: 'LLMCall'.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [src/core/LLMCall.ts:113](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L113)

Pricing adapter. When set, LLMCall emits `agentfootprint.cost.tick`
after every LLM response with per-call and cumulative USD. Run-scoped
— the cumulative resets on each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/LLMCall.ts:83](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L83)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/LLMCall.ts:133](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L133)

Optional build-time recorders threaded into footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
LLMCall's internal chart (Initialize + slot mounts + CallLLM). When
omitted, no build-time observation is wired up.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/core/LLMCall.ts:91](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/LLMCall.ts#L91)

Optional sampling temperature.
