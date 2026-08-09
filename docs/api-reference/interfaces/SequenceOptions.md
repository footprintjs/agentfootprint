[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SequenceOptions

# Interface: SequenceOptions

Defined in: [src/core-flow/Sequence.ts:34](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Sequence.ts#L34)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

Defined in: [src/core-flow/Sequence.ts:61](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Sequence.ts#L61)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the Sequence's `GroupMetadata` (kind `'Sequence'`, id,
name, ordered steps, no extras) and returns whatever shape the
translator produces. When omitted, `getUIGroup()` returns
`undefined`.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Sequence.ts:38](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Sequence.ts#L38)

Stable id used for topology + events. Default: 'sequence'.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Sequence.ts:36](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Sequence.ts#L36)

Human-friendly name for events + topology. Default: 'Sequence'.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Sequence.ts:52](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Sequence.ts#L52)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + each step mount + Finalize).

Cascade: each step runner attaches its OWN recorders at its own
construction time. footprintjs does NOT propagate StructureRecorders
into mounted subflows — attach the same recorders to every nested
composition for full coverage.

When omitted, no build-time observation is wired up.
