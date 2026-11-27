---
title: TimeDerivedRow
---

# Interface: TimeDerivedRow

Defined in: [src/time/rows/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L234)

The answer's values the library itself spelled from a time reading of this
turn (§ 9.5, step T7) — an implied year, an offset, the end-of-grain
minute, a value of the served time line. The lineage `derived-from-reading`:
the answer's standing reads it as "not sure" at most, never "known", and the
gate never calls these invented.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L237)

***

### kind

> `readonly` **kind**: `"time-derived"`

Defined in: [src/time/rows/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L235)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L236)

***

### values

> `readonly` **values**: readonly `string`[]

Defined in: [src/time/rows/types.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L239)

The values as the gate reports them — normalized, clipped, at most `MAX_DERIVED_VALUES`.
