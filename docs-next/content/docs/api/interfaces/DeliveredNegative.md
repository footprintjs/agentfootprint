---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4117](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4117)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4121](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4121)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4124](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4124)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4118](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4118)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4122](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4122)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4123](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4123)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4125](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4125)
