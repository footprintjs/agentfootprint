---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4127](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4127)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4131](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4131)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4134](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4134)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4128](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4128)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4132](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4132)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4133](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4133)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4135](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4135)
