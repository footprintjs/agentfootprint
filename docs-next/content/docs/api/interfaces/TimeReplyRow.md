---
title: TimeReplyRow
---

# Interface: TimeReplyRow

Defined in: [src/time/rows/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L148)

One request-bound correction decision, without the raw reply.

## Extends

- `TimeReplyEvidence`

## Properties

### decision

> `readonly` **decision**: `"range"` \| `"reask"` \| `"hold"`

Defined in: [src/time/replyRecord.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/time/replyRecord.ts#L18)

#### Inherited from

`TimeReplyEvidence.decision`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L151)

***

### kind

> `readonly` **kind**: `"time-reply"`

Defined in: [src/time/rows/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L149)

***

### mention

> `readonly` **mention**: `number`

Defined in: [src/time/rows/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L152)

***

### rule

> `readonly` **rule**: `"range-confirmed"` \| `"range-edited"` \| `"interval-corrected"` \| `"zone-corrected"` \| `"time-words-corrected"` \| `"both-filled"` \| `"neither-filled"` \| `"invalid-range"` \| `"invalid-correction"` \| `"unreadable-correction"` \| `"ambiguous-correction"` \| `"unresolved-correction"`

Defined in: [src/time/replyRecord.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/time/replyRecord.ts#L19)

#### Inherited from

`TimeReplyEvidence.rule`

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L150)
