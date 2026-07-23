---
title: CheckInDriver
---

# Interface: CheckInDriver

Defined in: src/core/checkin.ts:83

One ranked driver — a context unit and how strongly it aligns with the pick.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: src/core/checkin.ts:87

Origin group: `'system' | 'task' | 'result'`.

***

### id

> `readonly` **id**: `string`

Defined in: src/core/checkin.ts:85

The unit id (the citation, e.g. `'system-1'`).

***

### score

> `readonly` **score**: `number`

Defined in: src/core/checkin.ts:92

Alignment score — higher means it drove the pick more. Scorer-defined
 units; compare within one request, not across scorers.

***

### text

> `readonly` **text**: `string`

Defined in: src/core/checkin.ts:89

The unit text (quotable).
