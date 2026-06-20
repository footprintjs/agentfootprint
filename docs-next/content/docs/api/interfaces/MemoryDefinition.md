---
title: MemoryDefinition<T>
---

# Interface: MemoryDefinition\<T\>

Defined in: [src/memory/define.types.ts:235](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L235)

The opaque value `defineMemory()` returns. `Agent.memory()` consumes
one of these per memory the consumer registers; multiple definitions
layer cleanly via per-id scope keys (`memoryInjection_${id}`).

Generic `T` is the payload shape stored — `Message` for episodic,
`Fact` for semantic, `NarrativeBeat` for narrative, `RunSnapshot` for
causal. The factory infers `T` from `type`.

## Type Parameters

### T

`T` = `unknown`

## Properties

### asRole

> `readonly` **asRole**: [`ContextRole`](/docs/api/type-aliases/ContextRole)

Defined in: [src/memory/define.types.ts:255](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L255)

Role to use when injecting formatted content into the messages slot.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/memory/define.types.ts:240](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L240)

Surfaces in narrative / Lens hover.

***

### id

> `readonly` **id**: `string`

Defined in: [src/memory/define.types.ts:237](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L237)

Stable identifier. Becomes the scope-key suffix and the Lens label.

***

### projection?

> `readonly` `optional` **projection?**: [`SnapshotProjection`](/docs/api/type-aliases/SnapshotProjection)

Defined in: [src/memory/define.types.ts:261](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L261)

Snapshot projection — only meaningful when `type === CAUSAL`.

***

### read

> `readonly` **read**: `ReadonlyMemoryFlowChart`\<`T`\>

Defined in: [src/memory/define.types.ts:246](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L246)

Compiled read subflow (built by the factory from type × strategy).

***

### redact?

> `readonly` `optional` **redact?**: `MemoryRedactionPolicy`

Defined in: [src/memory/define.types.ts:258](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L258)

Reserved for a future release — patterns to redact before write.

***

### timing

> `readonly` **timing**: [`MemoryTiming`](/docs/api/type-aliases/MemoryTiming)

Defined in: [src/memory/define.types.ts:252](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L252)

When `read` runs. Default `TURN_START`.

***

### type

> `readonly` **type**: [`MemoryType`](/docs/api/type-aliases/MemoryType)

Defined in: [src/memory/define.types.ts:243](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L243)

Which TYPE shape — gates legal STRATEGY combinations.

***

### write?

> `readonly` `optional` **write?**: `ReadonlyMemoryFlowChart`\<`T`\>

Defined in: [src/memory/define.types.ts:249](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L249)

Compiled write subflow. Optional — `EPHEMERAL`-style configs omit.
