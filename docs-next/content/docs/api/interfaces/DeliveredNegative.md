---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3946](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3946)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3950](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3950)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3953](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3953)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3947](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3947)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3951](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3951)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3952](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3952)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3954](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3954)
