[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MemoryDefinition

# Interface: MemoryDefinition\<T\>

Defined in: [agentfootprint/src/memory/define.types.ts:234](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L234)

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

> `readonly` **asRole**: [`ContextRole`](/agentfootprint/api/generated/type-aliases/ContextRole.md)

Defined in: [agentfootprint/src/memory/define.types.ts:254](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L254)

Role to use when injecting formatted content into the messages slot.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [agentfootprint/src/memory/define.types.ts:239](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L239)

Surfaces in narrative / Lens hover.

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/memory/define.types.ts:236](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L236)

Stable identifier. Becomes the scope-key suffix and the Lens label.

***

### projection?

> `readonly` `optional` **projection?**: [`SnapshotProjection`](/agentfootprint/api/generated/type-aliases/SnapshotProjection.md)

Defined in: [agentfootprint/src/memory/define.types.ts:260](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L260)

Snapshot projection — only meaningful when `type === CAUSAL`.

***

### read

> `readonly` **read**: `ReadonlyMemoryFlowChart`\<`T`\>

Defined in: [agentfootprint/src/memory/define.types.ts:245](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L245)

Compiled read subflow (built by the factory from type × strategy).

***

### redact?

> `readonly` `optional` **redact?**: `MemoryRedactionPolicy`

Defined in: [agentfootprint/src/memory/define.types.ts:257](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L257)

Reserved for a future release — patterns to redact before write.

***

### timing

> `readonly` **timing**: [`MemoryTiming`](/agentfootprint/api/generated/type-aliases/MemoryTiming.md)

Defined in: [agentfootprint/src/memory/define.types.ts:251](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L251)

When `read` runs. Default `TURN_START`.

***

### type

> `readonly` **type**: [`MemoryType`](/agentfootprint/api/generated/type-aliases/MemoryType.md)

Defined in: [agentfootprint/src/memory/define.types.ts:242](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L242)

Which TYPE shape — gates legal STRATEGY combinations.

***

### write?

> `readonly` `optional` **write?**: `ReadonlyMemoryFlowChart`\<`T`\>

Defined in: [agentfootprint/src/memory/define.types.ts:248](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L248)

Compiled write subflow. Optional — `EPHEMERAL`-style configs omit.
