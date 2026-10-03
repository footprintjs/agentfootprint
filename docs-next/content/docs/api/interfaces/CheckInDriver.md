---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: [src/core/checkin.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L99)

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L103)

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L101)

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: [src/core/checkin.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L108)

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: [src/core/checkin.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L105)

The unit text (quotable).
