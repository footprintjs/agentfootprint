[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AskPayload

# Interface: AskPayload

Defined in: [src/core/agent/middleware/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L111)

What a person is being asked. Carried verbatim to the checkpoint.

## Properties

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L115)

Anything else the answering UI should render. Never interpreted here.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/agent/middleware/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/agent/middleware/types.ts#L113)

The question, in your own words. Shown to whoever answers.
