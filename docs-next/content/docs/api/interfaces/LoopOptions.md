---
title: LoopOptions
---

# Interface: LoopOptions

Defined in: [src/core-flow/Loop.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L44)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core-flow/Loop.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L62)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the Loop's `GroupMetadata` (kind `'Loop'`, id, name, body
as the single member, plus iteration budgets in `extra`).
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Loop.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L46)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Loop.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L45)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Loop.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L54)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + IterationStart + body mount +
Guard). When omitted, no build-time observation is wired up.
