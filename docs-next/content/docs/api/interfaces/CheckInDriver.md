---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: [src/core/checkin.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L143)

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L147)

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L145)

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: [src/core/checkin.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L152)

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: [src/core/checkin.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L149)

The unit text (quotable).
