[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallOptions

# Interface: LLMCallOptions

Defined in: [agentfootprint/src/core/LLMCall.ts:41](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L41)

## Properties

### costBudget?

> `readonly` `optional` **costBudget?**: `number`

Defined in: [agentfootprint/src/core/LLMCall.ts:65](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L65)

Cumulative USD budget per run. When provided along with `pricingTable`,
LLMCall emits `agentfootprint.cost.limit_hit` with `action: 'warn'`
the first time cumulative USD crosses the budget. Execution continues
— consumers choose whether to abort by listening to the event.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/core/LLMCall.ts:46](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L46)

Stable id used for topology + events. Default: 'llm-call'.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/core/LLMCall.ts:52](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L52)

Optional max output tokens.

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/core/LLMCall.ts:48](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L48)

Model to request from the provider.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/core/LLMCall.ts:44](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L44)

Human-friendly name shown in events/metrics. Default: 'LLMCall'.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [agentfootprint/src/core/LLMCall.ts:58](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L58)

Pricing adapter. When set, LLMCall emits `agentfootprint.cost.tick`
after every LLM response with per-call and cumulative USD. Run-scoped
— the cumulative resets on each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/core/LLMCall.ts:42](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L42)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/core/LLMCall.ts:50](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L50)

Optional sampling temperature.
