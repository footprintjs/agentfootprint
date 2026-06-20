---
title: ParallelOptions
---

# Interface: ParallelOptions

Defined in: [src/core-flow/Parallel.ts:37](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Parallel.ts#L37)

## Properties

### groupTranslator?

> `readonly` `optional` **groupTranslator?**: [`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

Defined in: [src/core-flow/Parallel.ts:69](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Parallel.ts#L69)

Optional per-COMPOSITION translator (UI-agnostic). When attached,
`runner.getUIGroup()` invokes it with the Parallel's
`GroupMetadata` (kind, id, name, branches list, merge strategy)
and returns whatever shape the translator produces.

Independent of `structureRecorders` — those observe per-node spec
events, this shapes whole-composition UI groups. Common case is to
thread the SAME `GroupTranslator` reference through every nested
composition so `member.uiGroup` is populated recursively; L1c
per-method overrides add finer control.

When omitted, `getUIGroup()` returns `undefined`.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Parallel.ts:39](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Parallel.ts#L39)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Parallel.ts:38](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Parallel.ts#L38)

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Parallel.ts:54](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core-flow/Parallel.ts#L54)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory. Each recorder observes per-node build
events (`onStageAdded` / `onSubflowMounted` / etc.) for this
composition's internal chart (Seed + each branch mount + Merge).

Cascade: each branch runner attaches its OWN recorders at its
own construction time. footprintjs does NOT propagate
StructureRecorders into mounted subflows — so for full coverage,
attach the same recorders to every nested composition. See the
core-flow README's "StructureRecorder cascade" section.

When omitted, no build-time observation is wired up.
