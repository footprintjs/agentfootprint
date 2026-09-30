---
title: TimePolicy
---

# Interface: TimePolicy

Defined in: [src/core/time/resolveRecord.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L103)

The v1 policy (§ 11): the two switches with two careful answers.

## Properties

### dateOrder

> `readonly` **dateOrder**: `"ask"` \| `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: [src/core/time/resolveRecord.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L105)

`'ask'`: a numeric date's readings become choices. Or the one order this app's people write.

***

### year

> `readonly` **year**: `"ask"` \| `"current"`

Defined in: [src/core/time/resolveRecord.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L107)

`'ask'`: a date said without a year is asked. `'current'`: the clock's year, recorded as assumed.
