---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4038](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4038)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4042](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4042)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4045](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4045)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4039](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4039)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4043](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4043)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4044](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4044)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4046](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4046)
