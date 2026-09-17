---
title: isCounterLookingAggregation
---

# Function: isCounterLookingAggregation()

> **isCounterLookingAggregation**(`aggregation`): `boolean`

Defined in: [src/lib/semantics/envelope.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/envelope.ts#L84)

Whole-token match against [COUNTER\_AGGREGATION\_WORDS](/docs/api/variables/COUNTER_AGGREGATION_WORDS), singular or
 plural, case-insensitive — 'sum' and 'Counts' look like counters,
 'summary' does not.

## Parameters

### aggregation

`string`

## Returns

`boolean`
