---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:4028](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4028)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:4032](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4032)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:4035](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4035)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:4029](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4029)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:4033](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4033)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:4034](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4034)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:4036](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L4036)
