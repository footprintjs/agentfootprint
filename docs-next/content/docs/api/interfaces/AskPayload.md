---
title: AskPayload
---

# Interface: AskPayload

Defined in: [src/core/agent/middleware/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L80)

What a person is being asked. Carried verbatim to the checkpoint.

## Properties

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L84)

Anything else the answering UI should render. Never interpreted here.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/agent/middleware/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L82)

The question, in your own words. Shown to whoever answers.
