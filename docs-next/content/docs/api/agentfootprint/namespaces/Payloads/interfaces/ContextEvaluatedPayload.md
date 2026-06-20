---
title: ContextEvaluatedPayload
---

# Interface: ContextEvaluatedPayload

Defined in: [src/events/payloads.ts:261](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L261)

Fired once per iteration by the Injection Engine after it evaluates every
Injection's trigger — BEFORE the Context fork routes the survivors into the
three slots. This is the "what was considered, what won, what was skipped
and why" signal; `context.slot_composed` is its downstream counterpart
("what actually landed in each slot"). Pure observability — no flow stage
reads it.

## Properties

### activeCount

> `readonly` **activeCount**: `number`

Defined in: [src/events/payloads.ts:264](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L264)

Number of injections active this iteration.

***

### activeIds

> `readonly` **activeIds**: readonly `string`[]

Defined in: [src/events/payloads.ts:270](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L270)

Ids of the active injections, in evaluation order.

***

### evaluatedTotal

> `readonly` **evaluatedTotal**: `number`

Defined in: [src/events/payloads.ts:268](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L268)

Total injections evaluated (the full declared list).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:262](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L262)

***

### routing?

> `readonly` `optional` **routing?**: readonly `object`[]

Defined in: [src/events/payloads.ts:296](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L296)

Routing PROVENANCE for the active injections that came from a `skillGraph()`
— *why* each was reached. One entry per active skill-graph injection (a
decision-tree leaf, a flat entry, or a route edge); absent when no active
injection carries skill-graph metadata. The structured counterpart to the
`context.routed` commentary line — lets the lens show the decision path, the
matched predicate, and the tools a route unlocked. Structural shape (mirrors
`SkillRouting` from the injection engine; events stay decoupled from it).

***

### skillCatalog

> `readonly` **skillCatalog**: readonly `object`[]

Defined in: [src/events/payloads.ts:286](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L286)

The Skill CATALOG the LLM was offered this turn — every registered Skill's
`id` + `description` (the same text that lands in the `read_skill` tool
description). Lets observers pair "what was offered" against "what the LLM
chose" (`read_skill` → `activatedInjectionIds`) when debugging a missed or
wrong activation. Empty when no Skills are registered. Static across turns.

***

### skippedCount

> `readonly` **skippedCount**: `number`

Defined in: [src/events/payloads.ts:266](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L266)

Number skipped (predicate false counts as neither — only errors/unknown land here).

***

### skippedDetails

> `readonly` **skippedDetails**: readonly `object`[]

Defined in: [src/events/payloads.ts:272](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L272)

Why each skipped injection was skipped (errors / unknown trigger kinds).

***

### triggerKindCounts

> `readonly` **triggerKindCounts**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [src/events/payloads.ts:278](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L278)

Count of active injections by trigger kind (always / rule / on-tool-return / llm-activated).
