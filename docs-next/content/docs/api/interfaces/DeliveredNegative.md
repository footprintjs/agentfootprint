---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4019](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4019)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4023](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4023)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4026](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4026)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4020](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4020)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4024](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4024)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4025](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4025)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4027](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4027)
