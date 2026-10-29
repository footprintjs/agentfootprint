---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3919](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3919)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3923](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3923)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3926](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3926)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3920](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3920)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3924](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3924)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3925](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3925)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3927](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3927)
