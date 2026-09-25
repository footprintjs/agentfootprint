[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isCounterLookingAggregation

# Function: isCounterLookingAggregation()

> **isCounterLookingAggregation**(`aggregation`): `boolean`

Defined in: [src/lib/semantics/envelope.ts:84](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/lib/semantics/envelope.ts#L84)

Whole-token match against [COUNTER\_AGGREGATION\_WORDS](/agentfootprint/api/generated/variables/COUNTER_AGGREGATION_WORDS.md), singular or
 plural, case-insensitive — 'sum' and 'Counts' look like counters,
 'summary' does not.

## Parameters

### aggregation

`string`

## Returns

`boolean`
