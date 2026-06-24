---
title: InjectionContext
---

# Interface: InjectionContext

Defined in: [src/lib/injection-engine/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L79)

Context passed to `rule` predicates. Read-only snapshot of the
agent's iteration state. Internal mutable state is hidden.

## Properties

### activatedInjectionIds

> `readonly` **activatedInjectionIds**: readonly `string`[]

Defined in: [src/lib/injection-engine/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L107)

IDs of LLM-activated injections that the LLM has activated this
turn (via their `viaToolName` tool call). Engine includes them
in the active set on subsequent iterations until turn end.

***

### currentSkillId?

> `readonly` `optional` **currentSkillId?**: `string`

Defined in: [src/lib/injection-engine/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L119)

The skill-graph CURSOR — which skill node the graph is currently
*in*, persisted across iterations. Undefined before the first entry
(cold start). `skillGraph()` route edges are `from`-gated against it:
an edge `A → B` only fires while `currentSkillId === 'A'`, which kills
cross-skill edge bleed (an edge firing while in an unrelated skill).

Set by the loop's cursor-update stage to `graph.nextSkill(ctx)` each
iteration; absent for agents that don't use `skillGraph()`. Plain
`rule`/`always`/`on-tool-return` predicates may ignore it.

***

### entryScorer?

> `readonly` `optional` **entryScorer?**: `string`

Defined in: [src/lib/injection-engine/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L134)

Name of the entry scorer that produced `entryScores` (e.g. `'keyword'`,
 `'embedding'`). Absent unless an entry scorer ran.

***

### entryScores?

> `readonly` `optional` **entryScores?**: readonly `object`[]

Defined in: [src/lib/injection-engine/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L127)

The relevance ranking of entry candidates from an entry scorer (`.entryBy()` /
`.entryByRelevance()`) — written by the PickEntry stage at turn start.
`defineRelevanceHint()` reads it to detect a near-tie. Absent unless the graph
used an entry scorer. `score` is the raw strategy score (cosine / word-overlap);
`relevance` is the softmax share (the surfaced %).

***

### history

> `readonly` **history**: readonly `object`[]

Defined in: [src/lib/injection-engine/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L88)

Conversation history up to (but not including) the current
iteration's LLM call. Includes prior iterations within the same turn.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/lib/injection-engine/types.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L81)

Current ReAct iteration (1-based).

***

### lastToolResult?

> `readonly` `optional` **lastToolResult?**: `object`

Defined in: [src/lib/injection-engine/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L98)

The most recent tool result, if the previous iteration ended in a
tool call. Used both by `rule` predicates and by `on-tool-return`
trigger evaluation.

#### result

> `readonly` **result**: `string`

#### toolName

> `readonly` **toolName**: `string`

***

### userMessage

> `readonly` **userMessage**: `string`

Defined in: [src/lib/injection-engine/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L83)

The current user message that started this turn.
