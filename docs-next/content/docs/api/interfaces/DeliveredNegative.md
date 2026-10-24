---
title: DeliveredNegative
---

# Interface: DeliveredNegative

Defined in: [src/events/payloads.ts:3709](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3709)

One library-written negative statement, shared by delivery and its event.

## Properties

### about?

> `readonly` `optional` **about?**: `string` \| `number`

Defined in: [src/events/payloads.ts:3713](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3713)

Unchecked model display text. It never selects a subject or evidence. Quote and label it
as model wording when rendered; the library statement names the actual searched scope.

***

### delivery

> `readonly` **delivery**: `"record-composed"`

Defined in: [src/events/payloads.ts:3716](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3716)

***

### kind

> `readonly` **kind**: `"none"` \| `"unknown"` \| `"not-found"` \| `"complete"`

Defined in: [src/events/payloads.ts:3710](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3710)

***

### restsOn

> `readonly` **restsOn**: readonly `string`[]

Defined in: [src/events/payloads.ts:3714](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3714)

***

### statement

> `readonly` **statement**: `string`

Defined in: [src/events/payloads.ts:3715](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3715)

***

### version

> `readonly` **version**: `string`

Defined in: [src/events/payloads.ts:3717](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L3717)
