---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3718](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3718)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3722](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3722)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3725](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3725)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3719](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3719)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3723](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3723)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3724](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3724)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3726](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3726)
