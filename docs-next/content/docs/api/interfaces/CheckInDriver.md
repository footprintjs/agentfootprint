---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: [src/core/checkin.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L111)

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L115)

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L113)

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: [src/core/checkin.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L120)

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: [src/core/checkin.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L117)

The unit text (quotable).
