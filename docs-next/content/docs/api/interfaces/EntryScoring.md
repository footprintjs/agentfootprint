---
title: EntryScoring
---

# Interface: EntryScoring

Defined in: [src/lib/injection-engine/skillGraph.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L106)

Result of `graph.scoreEntries(ctx)` — the picked entry + the full ranking.

## Properties

### chosen

> `readonly` **chosen**: `string` \| `undefined`

Defined in: [src/lib/injection-engine/skillGraph.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L108)

The winning entry id (argmax cosine), or undefined if no candidate.

***

### ranked

> `readonly` **ranked**: readonly [`EntryScore`](/docs/api/interfaces/EntryScore)[]

Defined in: [src/lib/injection-engine/skillGraph.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L110)

Every scored candidate, in declaration order.
