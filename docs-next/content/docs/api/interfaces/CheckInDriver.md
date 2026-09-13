---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: src/core/checkin.ts:94

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: src/core/checkin.ts:98

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: src/core/checkin.ts:96

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: src/core/checkin.ts:103

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: src/core/checkin.ts:100

The unit text (quotable).
