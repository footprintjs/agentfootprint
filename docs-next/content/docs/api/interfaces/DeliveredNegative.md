---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4159](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4159)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4163](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4163)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4166](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4166)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4160](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4160)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4164](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4164)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4165](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4165)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4167](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4167)
