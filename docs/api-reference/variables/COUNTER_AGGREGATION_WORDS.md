[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / COUNTER\_AGGREGATION\_WORDS

# Variable: COUNTER\_AGGREGATION\_WORDS

> `const` **COUNTER\_AGGREGATION\_WORDS**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/semantics/types.ts#L238)

Aggregation words that suggest the values are counters — the words that
make `grain.is_counter` REQUIRED (stated true or false). Matched as whole
tokens, singular or plural, case-insensitive.
