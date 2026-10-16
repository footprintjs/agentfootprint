---
title: LoopOptions
---

# Interface: LoopOptions

Defined in: [src/core-flow/Loop.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L55)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core-flow/Loop.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L73)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the Loop's `GroupMetadata` (kind `'Loop'`, id, name, body
as the single member, plus iteration budgets in `extra`).
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Loop.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L57)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Loop.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L56)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Loop.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L65)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + IterationStart + body mount +
Guard). When omitted, no build-time observation is wired up.
