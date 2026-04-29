[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Embedder

# Interface: Embedder

Defined in: [agentfootprint/src/memory/embedding/types.ts:38](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/embedding/types.ts#L38)

An Embedder turns text into a dense vector of constant dimensionality.
Implement `embedBatch` for backends that support one-call multi-embed
(OpenAI / Voyage / etc.) — without it, batch callers fall back to
N sequential `embed()` calls.

## Properties

### dimensions

> `readonly` **dimensions**: `number`

Defined in: [agentfootprint/src/memory/embedding/types.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/embedding/types.ts#L40)

Vector length. Constant per embedder instance.

## Methods

### embed()

> **embed**(`args`): `Promise`\<`number`[]\>

Defined in: [agentfootprint/src/memory/embedding/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/embedding/types.ts#L43)

Embed a single text into a vector of length `dimensions`.

#### Parameters

##### args

`EmbedArgs`

#### Returns

`Promise`\<`number`[]\>

***

### embedBatch()?

> `optional` **embedBatch**(`args`): `Promise`\<`number`[][]\>

Defined in: [agentfootprint/src/memory/embedding/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/embedding/types.ts#L50)

Optional batch API. When present, pipeline stages can avoid N
sequential round-trips for turn-level indexing. Adapter SHOULD
implement when the backend supports it.

#### Parameters

##### args

`EmbedBatchArgs`

#### Returns

`Promise`\<`number`[][]\>
