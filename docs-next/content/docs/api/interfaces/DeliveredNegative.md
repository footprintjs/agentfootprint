---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3888](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3888)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3892](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3892)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3895](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3895)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3889](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3889)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3893](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3893)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3894](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3894)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3896](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3896)
