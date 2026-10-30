---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4149](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4149)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4153](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4153)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4156](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4156)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4150](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4150)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4154](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4154)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4155](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4155)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4157](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4157)
