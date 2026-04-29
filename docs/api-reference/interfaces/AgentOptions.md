[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentOptions

# Interface: AgentOptions

Defined in: [agentfootprint/src/core/Agent.ts:65](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L65)

## Properties

### costBudget?

> `readonly` `optional` **costBudget?**: `number`

Defined in: [agentfootprint/src/core/Agent.ts:88](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L88)

Cumulative USD budget per run. With `pricingTable`, Agent emits a
one-shot `agentfootprint.cost.limit_hit` (`action: 'warn'`) when
cumulative USD crosses this budget. Execution continues — consumers
choose whether to abort by listening to the event.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/core/Agent.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L70)

Stable id used for topology + events. Default: 'agent'.

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [agentfootprint/src/core/Agent.ts:75](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L75)

Hard budget on ReAct iterations. Default: 10. Hard cap: 50.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/core/Agent.ts:73](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L73)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/core/Agent.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L71)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/core/Agent.ts:68](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L68)

Human-friendly name shown in events/metrics. Default: 'Agent'.

***

### permissionChecker?

> `readonly` `optional` **permissionChecker?**: [`PermissionChecker`](/agentfootprint/api/generated/interfaces/PermissionChecker.md)

Defined in: [agentfootprint/src/core/Agent.ts:97](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L97)

Permission adapter. When set, the Agent calls
`permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
`tool.execute()`. Emits `agentfootprint.permission.check` with the
decision. On `deny`, the tool is skipped and its result is a
synthetic denial string; on `allow` / `gate_open`, execution proceeds
normally.

***

### pricingTable?

> `readonly` `optional` **pricingTable?**: [`PricingTable`](/agentfootprint/api/generated/interfaces/PricingTable.md)

Defined in: [agentfootprint/src/core/Agent.ts:81](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L81)

Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
after every LLM response (once per ReAct iteration) with per-call
and cumulative USD. Run-scoped — the cumulative resets each `.run()`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/core/Agent.ts:66](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L66)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/core/Agent.ts:72](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/Agent.ts#L72)
