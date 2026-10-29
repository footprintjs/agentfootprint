---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3713](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3713)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3717](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3717)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3720](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3720)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3714](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3714)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3718](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3718)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3719](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3719)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3721](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3721)
