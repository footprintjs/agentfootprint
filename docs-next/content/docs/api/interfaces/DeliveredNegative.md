---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads/answer.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L58)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads/answer.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L62)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads/answer.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L65)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads/answer.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L59)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads/answer.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L63)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads/answer.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L64)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads/answer.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads/answer.ts#L66)
