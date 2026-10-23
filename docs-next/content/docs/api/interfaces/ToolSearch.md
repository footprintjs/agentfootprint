---
title: ToolSearch
---

# Interface: ToolSearch

Defined in: [src/semantics/coverage/search/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L121)

WHAT ONE CALL OF THIS TOOL SEARCHES — declared once; the library composes
each call's coverage from it and the arguments the call ran with.

## Example

```ts
search: {
  source: { what: 'the incident store', said: ['the incident store'] },
  subject: { what: 'incidents', said: ['incident', 'incidents'] },
  fixed: [{ name: 'status', value: 'open', said: ['open'] }],
  arguments: [
    { name: 'service', role: 'population' },
    { name: 'window', role: 'period', whenOmitted: '2h' },
  ],
  complete: 'within-arguments',
}
```

## Properties

### arguments

> `readonly` **arguments**: readonly `SearchArgument`[]

Defined in: [src/semantics/coverage/search/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L125)

***

### complete?

> `readonly` `optional` **complete?**: `"within-arguments"`

Defined in: [src/semantics/coverage/search/types.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L131)

The tool's statement that a call is complete for the population, filters
and period in effect when no cap was reached and no page was open. Absent
= never complete.

***

### fixed?

> `readonly` `optional` **fixed?**: readonly `SearchFixed`[]

Defined in: [src/semantics/coverage/search/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L124)

***

### gaps?

> `readonly` `optional` **gaps?**: readonly `SearchGap`[]

Defined in: [src/semantics/coverage/search/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L132)

***

### limits?

> `readonly` `optional` **limits?**: `SearchLimits`

Defined in: [src/semantics/coverage/search/types.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L133)

***

### ranking?

> `readonly` `optional` **ranking?**: `"approximate"`

Defined in: [src/semantics/coverage/search/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L139)

`'approximate'` — a vector, top-k or fuzzy ranking: the rows are the ones
ranked nearest, never every row that fits, so every call carries a
`ranking` gap on completeness and `complete` is refused beside it.

***

### source

> `readonly` **source**: `SearchWords`

Defined in: [src/semantics/coverage/search/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L122)

***

### subject

> `readonly` **subject**: `SearchWords`

Defined in: [src/semantics/coverage/search/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L123)
