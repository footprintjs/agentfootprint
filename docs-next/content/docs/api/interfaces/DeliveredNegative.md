---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3937](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3937)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3941](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3941)

The single public population value derived from admitted searches, never model wording.
Omitted for multiple or unknown subjects; their individual scopes remain in the statement.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3944](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3944)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3938](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3938)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3942](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3942)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3943](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3943)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3945](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3945)
