---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4052](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4052)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4056](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4056)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4059](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4059)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4053](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4053)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4057](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4057)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4058](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4058)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4060](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4060)
