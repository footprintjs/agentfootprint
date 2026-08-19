[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactConformanceKit

# Interface: ArtifactConformanceKit

Defined in: [src/artifacts/conformance/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L138)

The helpers a case is handed, beside the store.

## Properties

### harness

> `readonly` **harness**: [`ArtifactStoreHarness`](/agentfootprint/api/generated/interfaces/ArtifactStoreHarness.md)

Defined in: [src/artifacts/conformance/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L167)

The harness, for a case that wants to name it in a message.

***

### token

> `readonly` **token**: `string`

Defined in: [src/artifacts/conformance/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L149)

The unique token behind [scope](/agentfootprint/api/generated/interfaces/ArtifactConformanceKit.md#scope), for the cases that build their own
scope TUPLES — the confusable pairs mean nothing if a helper rewrites the
very fields whose spelling is under test.

## Methods

### advance()

> **advance**(`store`, `ms`): `Promise`\<`void`\>

Defined in: [src/artifacts/conformance/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L161)

Move the store's clock. Present only where the case declared the hook.

#### Parameters

##### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### bounded()

> **bounded**(`maxBytesPerScope`): `Promise`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)\>

Defined in: [src/artifacts/conformance/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L165)

A second store with a small byte budget; disposed with the case's own.

#### Parameters

##### maxBytesPerScope

`number`

#### Returns

`Promise`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)\>

***

### corrupt()

> **corrupt**(`store`, `scope`, `ref`): `Promise`\<`void`\>

Defined in: [src/artifacts/conformance/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L163)

Damage a stored payload. Present only where the case declared the hook.

#### Parameters

##### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

##### scope

`MemoryIdentity`

##### ref

`string`

#### Returns

`Promise`\<`void`\>

***

### now()

> **now**(`store`): `Promise`\<`number`\>

Defined in: [src/artifacts/conformance/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L159)

The STORE's own idea of now, read the only way the port exposes it: mint a
throwaway artifact in a private scope and read the `createdAt` it stamped.

A store on an injected clock and a store on the wall clock are both
entitled to their own calendar, so a case that computed an expiry from
`Date.now()` would state a time the store may consider the distant future
— and then pass by never expiring anything.

#### Parameters

##### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

#### Returns

`Promise`\<`number`\>

***

### scope()

> **scope**(`suffix`): `MemoryIdentity`

Defined in: [src/artifacts/conformance/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/conformance/types.ts#L143)

A scope nothing else in this run uses. Cases address their own scope so
two batteries pointed at one shared backend cannot read each other's rows.

#### Parameters

##### suffix

`string`

#### Returns

`MemoryIdentity`
