[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallOptions

# Interface: LLMCallOptions

Defined in: [src/core/LLMCall.ts:74](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L74)

## Properties

### costBudget?

> `readonly` `optional` **costBudget?**: `number`

Defined in: [src/core/LLMCall.ts:98](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L98)

Cumulative USD budget per run. When provided along with `pricingTable`,
LLMCall emits `agentfootprint.cost.limit_hit` with `action: 'warn'`
the first time cumulative USD crosses the budget. Execution continues
— consumers choose whether to abort by listening to the event.

***

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core/LLMCall.ts:116](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L116)

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

Defined in: [src/core/LLMCall.ts:79](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L79)

Stable id used for topology + events. Default: 'llm-call'.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/core/LLMCall.ts:85](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L85)

Optional max output tokens.

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/LLMCall.ts:81](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L81)

Model to request from the provider.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/LLMCall.ts:77](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L77)

Human-friendly name shown in events/metrics. Default: 'LLMCall'.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [src/core/LLMCall.ts:91](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L91)

Pricing adapter. When set, LLMCall emits `agentfootprint.cost.tick`
after every LLM response with per-call and cumulative USD. Run-scoped
— the cumulative resets on each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/core/LLMCall.ts:75](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L75)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/LLMCall.ts:106](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L106)

Optional build-time recorders threaded into footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
LLMCall's internal chart (Initialize + slot mounts + CallLLM). When
omitted, no build-time observation is wired up.

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/core/LLMCall.ts:83](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/LLMCall.ts#L83)

Optional sampling temperature.
