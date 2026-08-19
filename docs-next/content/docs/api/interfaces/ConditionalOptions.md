---
title: ConditionalOptions
---

# Interface: ConditionalOptions

Defined in: [src/core-flow/Conditional.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L37)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core-flow/Conditional.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L56)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the Conditional's `GroupMetadata` (kind `'Conditional'`,
id, name, branches as members, plus `extra.fallbackId`).
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Conditional.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L39)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Conditional.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L38)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Conditional.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L48)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + Route decider + each branch
mount + Finalize). When omitted, no build-time observation is
wired up.
