---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3932](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3932)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3936](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3936)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3939](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3939)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3933](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3933)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3937](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3937)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3938](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3938)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3940](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3940)
