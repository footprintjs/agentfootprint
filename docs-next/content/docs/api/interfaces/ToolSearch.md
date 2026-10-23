---
title: ToolSearch
---

# Interface: ToolSearch

Defined in: [src/semantics/coverage/search/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L104)

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

Defined in: [src/semantics/coverage/search/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L108)

***

### complete?

> `readonly` `optional` **complete?**: `"within-arguments"`

Defined in: [src/semantics/coverage/search/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L114)

The tool's statement that a call is complete for the population, filters
and period in effect when no cap was reached and no page was open. Absent
= never complete.

***

### fixed?

> `readonly` `optional` **fixed?**: readonly `SearchFixed`[]

Defined in: [src/semantics/coverage/search/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L107)

***

### gaps?

> `readonly` `optional` **gaps?**: readonly `SearchGap`[]

Defined in: [src/semantics/coverage/search/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L115)

***

### limits?

> `readonly` `optional` **limits?**: `SearchLimits`

Defined in: [src/semantics/coverage/search/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L116)

***

### source

> `readonly` **source**: `SearchWords`

Defined in: [src/semantics/coverage/search/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L105)

***

### subject

> `readonly` **subject**: `SearchWords`

Defined in: [src/semantics/coverage/search/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/search/types.ts#L106)
