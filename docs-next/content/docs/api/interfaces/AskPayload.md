---
title: AskPayload
---

# Interface: AskPayload

Defined in: [src/core/agent/middleware/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L112)

What a person is being asked. Carried verbatim to the checkpoint.

## Properties

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/agent/middleware/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L123)

Which REGISTERED screen component collects the answer (9.24.0) — ids and
props only, never markup. Small props inline; big props as an artifact
ref (`propsRef`), validated to resolve at raise time. Absent → the prose
`question`, exactly as before.

***

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L116)

Anything else the answering UI should render. Never interpreted here.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/agent/middleware/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L114)

The question, in your own words. Shown to whoever answers.
