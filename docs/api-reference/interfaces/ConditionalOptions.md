[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConditionalOptions

# Interface: ConditionalOptions

Defined in: [src/core-flow/Conditional.ts:36](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core-flow/Conditional.ts#L36)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core-flow/Conditional.ts:55](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core-flow/Conditional.ts#L55)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the Conditional's `GroupMetadata` (kind `'Conditional'`,
id, name, branches as members, plus `extra.fallbackId`).
Returns `undefined` when omitted.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Conditional.ts:38](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core-flow/Conditional.ts#L38)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Conditional.ts:37](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core-flow/Conditional.ts#L37)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Conditional.ts:47](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core-flow/Conditional.ts#L47)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + Route decider + each branch
mount + Finalize). When omitted, no build-time observation is
wired up.
