---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4062](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4062)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4066](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4066)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4069](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4069)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4063](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4063)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4067](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4067)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4068](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4068)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4070](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4070)
