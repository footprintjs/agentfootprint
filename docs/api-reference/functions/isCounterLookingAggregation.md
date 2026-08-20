[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isCounterLookingAggregation

# Function: isCounterLookingAggregation()

> **isCounterLookingAggregation**(`aggregation`): `boolean`

Defined in: [src/lib/semantics/envelope.ts:84](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/envelope.ts#L84)

Whole-token match against [COUNTER\_AGGREGATION\_WORDS](/agentfootprint/api/generated/variables/COUNTER_AGGREGATION_WORDS.md), singular or
 plural, case-insensitive — 'sum' and 'Counts' look like counters,
 'summary' does not.

## Parameters

### aggregation

`string`

## Returns

`boolean`
