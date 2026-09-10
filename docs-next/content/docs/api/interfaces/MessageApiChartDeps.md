---
title: MessageApiChartDeps
---

# Interface: MessageApiChartDeps

Defined in: [src/core/agent/buildMessageApiChart.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildMessageApiChart.ts#L70)

## Properties

### getRunId?

> `readonly` `optional` **getRunId?**: () => `string` \| `undefined`

Defined in: [src/core/agent/buildMessageApiChart.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildMessageApiChart.ts#L106)

The id of the run this chart is about to make (9.91.0) — supply it and
Call-LLM mints a receipt, the fingerprint of what the model was handed,
committed at the call for `receiptAt` and `servedAt` to read.

IT IS A DEP BECAUSE THIS IS A CHART BUILDER, NOT A RUNNER. `Agent` and
`LLMCall` own their executor and mint a run id per run; this chart is
handed to a `FlowChartExecutor` the caller owns, and nothing in a stage's
scope carries that executor's run id. So the one value the receipt cannot
do without has to come from whoever starts the run.

OMIT IT AND NO RECEIPT IS MINTED — deliberately, rather than minting an
unsalted one. Every hash on a receipt is salted with the run id precisely
so a short system prompt or a two-word turn cannot be fingerprinted across
runs (`receipt.ts`, the third law), and a receipt is committed state that
travels in recordings. A chart that minted with an empty salt would ship
dictionary-attackable fingerprints by default. `servedAt` then declares
the absence — `no-receipt-on-chart`, cause `'no-receipt-committed'` — and
rebuilds the view as it always did.

#### Returns

`string` \| `undefined`

#### Example

**(internal — \`buildMessageApiChart\` is not on the package's public**

surface; the type is, so a caller composing this chart inside the library
reads the contract here)
```ts
const runId = `run-${Date.now()}`;
const chart = buildMessageApiChart({ provider, model, systemPrompt, getRunId: () => runId });
const executor = new FlowChartExecutor(chart);
await executor.run({ input: { message: 'hi' } });
receiptAt(executor.getSnapshot(), 1)?.basis.runId; // runId
```

***

### model

> `readonly` **model**: `string`

Defined in: [src/core/agent/buildMessageApiChart.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildMessageApiChart.ts#L72)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/core/agent/buildMessageApiChart.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildMessageApiChart.ts#L71)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core/agent/buildMessageApiChart.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildMessageApiChart.ts#L74)

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/core/agent/buildMessageApiChart.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildMessageApiChart.ts#L73)
