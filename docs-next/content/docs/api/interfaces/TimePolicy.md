---
title: TimePolicy
---

# Interface: TimePolicy

Defined in: [src/core/time/resolve.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L151)

The v1 policy (§ 11): the two switches with two careful answers.

## Properties

### dateOrder

> `readonly` **dateOrder**: `"ask"` \| `"MDY"` \| `"DMY"` \| `"YMD"`

Defined in: [src/core/time/resolve.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L153)

`'ask'`: a numeric date's readings become choices. Or the one order this app's people write.

***

### year

> `readonly` **year**: `"ask"` \| `"current"`

Defined in: [src/core/time/resolve.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L155)

`'ask'`: a date said without a year is asked. `'current'`: the clock's year, recorded as assumed.
