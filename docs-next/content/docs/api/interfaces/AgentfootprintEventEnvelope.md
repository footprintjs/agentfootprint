---
title: AgentfootprintEventEnvelope<TType, TPayload>
---

# Interface: AgentfootprintEventEnvelope\<TType, TPayload\>

Defined in: [src/events/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/types.ts#L102)

Discriminated-union envelope every event implements.

## Type Parameters

### TType

`TType` *extends* `string`

### TPayload

`TPayload`

## Properties

### meta

> `readonly` **meta**: [`EventMeta`](/docs/api/interfaces/EventMeta)

Defined in: [src/events/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/types.ts#L105)

***

### payload

> `readonly` **payload**: `TPayload`

Defined in: [src/events/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/types.ts#L104)

***

### type

> `readonly` **type**: `TType`

Defined in: [src/events/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/types.ts#L103)
