---
title: AgentMessageApiChartDeps
---

# Interface: AgentMessageApiChartDeps

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L67)

## Properties

### getRunId?

> `readonly` `optional` **getRunId?**: () => `string` \| `undefined`

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L95)

The id of the run this chart is about to make (9.91.0) — supply it and
Call-LLM mints a receipt on every turn of the loop, the fingerprint of
what the model was handed, committed at each call for `receiptAt` and
`servedAt` to read. The twin of `MessageApiChartDeps.getRunId`, and for
the same reason: this is a chart BUILDER handed to an executor the caller
owns, so the salt has to come from whoever starts the run.

OMIT IT AND NO RECEIPT IS MINTED — never an unsalted one. The rule and its
reason live in `messageApiReceipt.ts`; `servedAt` declares the absence and
rebuilds the view as it always did.

#### Returns

`string` \| `undefined`

#### Example

**(internal — \`buildAgentMessageApiChart\` is not on the package's**

public surface; the type is, so a caller composing this chart inside the
library reads the contract here)
```ts
const runId = `run-${Date.now()}`;
const chart = buildAgentMessageApiChart({ ...deps, getRunId: () => runId });
await new FlowChartExecutor(chart).run({ input: { message: 'hi' } });
```

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L72)

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L69)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L68)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L73)

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L70)

***

### tools

> `readonly` **tools**: readonly [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)[]

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L71)
