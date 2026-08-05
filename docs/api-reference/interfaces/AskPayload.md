[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AskPayload

# Interface: AskPayload

Defined in: [src/core/agent/middleware/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/middleware/types.ts#L111)

What a person is being asked. Carried verbatim to the checkpoint.

## Properties

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/middleware/types.ts#L115)

Anything else the answering UI should render. Never interpreted here.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/agent/middleware/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/agent/middleware/types.ts#L113)

The question, in your own words. Shown to whoever answers.
