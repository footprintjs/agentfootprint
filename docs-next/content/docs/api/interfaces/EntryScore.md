---
title: EntryScore
---

# Interface: EntryScore

Defined in: [src/lib/injection-engine/skillGraph.ts:96](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L96)

One entry candidate's relevance to the user's message.

## Properties

### cosine

> `readonly` **cosine**: `number`

Defined in: [src/lib/injection-engine/skillGraph.ts:100](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L100)

Raw cosine similarity (message ↔ the skill's description), -1..1.

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:98](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L98)

The entry skill id.

***

### relevance

> `readonly` **relevance**: `number`

Defined in: [src/lib/injection-engine/skillGraph.ts:102](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L102)

Softmax share across the candidates, 0..1 — the surfaced relevance %.
