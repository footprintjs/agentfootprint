---
title: SemanticGrain
---

# Interface: SemanticGrain

Defined in: [src/lib/semantics/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L87)

The grain — what one value MEANS, stated when it is not what a reader
would assume. This is the field that stops a model from adding
`jobs_local` to `jobs_replicated_in` and announcing a fleet size nobody
has.

## Properties

### aggregation?

> `readonly` `optional` **aggregation?**: `string`

Defined in: [src/lib/semantics/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L91)

How the values were folded ('avg', 'max', 'sum', 'count', …).

***

### collapsed?

> `readonly` `optional` **collapsed?**: `string`

Defined in: [src/lib/semantics/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L100)

What was folded away ('per-port rows collapsed to per-switch').

***

### interval?

> `readonly` `optional` **interval?**: `string`

Defined in: [src/lib/semantics/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L89)

The collection interval the values live on ('30m', '1h', 'daily').

***

### is\_counter?

> `readonly` `optional` **is\_counter?**: `boolean`

Defined in: [src/lib/semantics/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/types.ts#L98)

Whether the values are counters. MUST be stated (true or false) whenever
`aggregation` is counter-looking (see
[COUNTER\_AGGREGATION\_WORDS](/docs/api/variables/COUNTER_AGGREGATION_WORDS)): summing two counters double-counts,
and a reader cannot tell a counter from a gauge by looking at a number.
