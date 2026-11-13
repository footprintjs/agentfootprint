---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: [src/core/checkin.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L112)

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L116)

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L114)

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: [src/core/checkin.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L121)

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: [src/core/checkin.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L118)

The unit text (quotable).
