---
title: SequenceOptions
---

# Interface: SequenceOptions

Defined in: [src/core-flow/Sequence.ts:33](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Sequence.ts#L33)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core-flow/Sequence.ts:60](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Sequence.ts#L60)

Optional per-COMPOSITION translator (UI-agnostic). See
`core/translator.ts`. When attached, `runner.getUIGroup()` invokes
it with the Sequence's `GroupMetadata` (kind `'Sequence'`, id,
name, ordered steps, no extras) and returns whatever shape the
translator produces. When omitted, `getUIGroup()` returns
`undefined`.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Sequence.ts:37](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Sequence.ts#L37)

Stable id used for topology + events. Default: 'sequence'.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Sequence.ts:35](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Sequence.ts#L35)

Human-friendly name for events + topology. Default: 'Sequence'.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Sequence.ts:51](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Sequence.ts#L51)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + each step mount + Finalize).

Cascade: each step runner attaches its OWN recorders at its own
construction time. footprintjs does NOT propagate StructureRecorders
into mounted subflows — attach the same recorders to every nested
composition for full coverage.

When omitted, no build-time observation is wired up.
