---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4024](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4024)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4028](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4028)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4031](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4031)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4025](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4025)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4029](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4029)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4030](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4030)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4032](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4032)
