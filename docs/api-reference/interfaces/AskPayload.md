[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AskPayload

# Interface: AskPayload

Defined in: src/core/agent/middleware/types.ts:80

What a person is being asked. Carried verbatim to the checkpoint.

## Properties

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: src/core/agent/middleware/types.ts:84

Anything else the answering UI should render. Never interpreted here.

***

### question

> `readonly` **question**: `string`

Defined in: src/core/agent/middleware/types.ts:82

The question, in your own words. Shown to whoever answers.
