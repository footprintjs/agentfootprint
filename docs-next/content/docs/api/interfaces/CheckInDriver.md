---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: [src/core/checkin.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L136)

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L140)

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/checkin.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L138)

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: [src/core/checkin.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L145)

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: [src/core/checkin.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L142)

The unit text (quotable).
