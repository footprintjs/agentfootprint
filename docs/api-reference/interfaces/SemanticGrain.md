[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SemanticGrain

# Interface: SemanticGrain

Defined in: [src/lib/semantics/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L86)

The grain — what one value MEANS, stated when it is not what a reader
would assume. This is the field that stops a model from adding
`jobs_local` to `jobs_replicated_in` and announcing a fleet size nobody
has.

## Properties

### aggregation?

> `readonly` `optional` **aggregation?**: `string`

Defined in: [src/lib/semantics/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L90)

How the values were folded ('avg', 'max', 'sum', 'count', …).

***

### collapsed?

> `readonly` `optional` **collapsed?**: `string`

Defined in: [src/lib/semantics/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L99)

What was folded away ('per-port rows collapsed to per-switch').

***

### interval?

> `readonly` `optional` **interval?**: `string`

Defined in: [src/lib/semantics/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L88)

The collection interval the values live on ('30m', '1h', 'daily').

***

### is\_counter?

> `readonly` `optional` **is\_counter?**: `boolean`

Defined in: [src/lib/semantics/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L97)

Whether the values are counters. MUST be stated (true or false) whenever
`aggregation` is counter-looking (see
[COUNTER\_AGGREGATION\_WORDS](/agentfootprint/api/generated/variables/COUNTER_AGGREGATION_WORDS.md)): summing two counters double-counts,
and a reader cannot tell a counter from a gauge by looking at a number.
