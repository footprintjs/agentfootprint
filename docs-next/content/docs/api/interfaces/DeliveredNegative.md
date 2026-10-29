---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3871](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3871)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3875](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3875)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3878](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3878)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3872](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3872)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3876](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3876)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3877](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3877)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3879](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3879)
