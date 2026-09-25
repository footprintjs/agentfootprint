[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / COUNTER\_AGGREGATION\_WORDS

# Variable: COUNTER\_AGGREGATION\_WORDS

> `const` **COUNTER\_AGGREGATION\_WORDS**: readonly `string`[]

Defined in: [src/lib/semantics/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/lib/semantics/types.ts#L238)

Aggregation words that suggest the values are counters — the words that
make `grain.is_counter` REQUIRED (stated true or false). Matched as whole
tokens, singular or plural, case-insensitive.
