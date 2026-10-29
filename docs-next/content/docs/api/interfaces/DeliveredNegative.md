---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4084](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4084)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4088](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4088)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4091](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4091)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4085](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4085)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4089](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4089)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4090](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4090)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4092](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4092)
