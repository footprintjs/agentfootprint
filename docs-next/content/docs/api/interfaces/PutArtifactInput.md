---
title: PutArtifactInput
---

# Interface: PutArtifactInput

Defined in: [src/artifacts/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L120)

What `put` takes — everything on [ArtifactMeta](/docs/api/interfaces/ArtifactMeta) the CALLER owns.
 `ref`, `bytes`, `digest` and `createdAt` are the store's to stamp.

## Properties

### data

> `readonly` **data**: `unknown`

Defined in: [src/artifacts/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L129)

The payload. Strings and `Uint8Array` are stored byte-for-byte; any other
value must be JSON-serializable (it is measured, digested and — in the
durable adapters — persisted via JSON). A value JSON cannot carry is
refused at `put` by name, never stored as an approximation.

***

### digest?

> `readonly` `optional` **digest?**: `"sha-256"`

Defined in: [src/artifacts/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L132)

Ask for an integrity digest, computed by the store at put.

***

### expiresAt?

> `readonly` `optional` **expiresAt?**: `number`

Defined in: [src/artifacts/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L134)

Caller-stated expiry (unix ms). The store's own ttl may only TIGHTEN it.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L121)

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L130)

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L122)

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/docs/api/interfaces/ArtifactOrigin)

Defined in: [src/artifacts/types.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L135)

***

### parentRefs?

> `readonly` `optional` **parentRefs?**: readonly `string`[]

Defined in: [src/artifacts/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L136)

***

### timeAxis?

> `readonly` `optional` **timeAxis?**: [`DatasetTimeAxis`](/docs/api/interfaces/DatasetTimeAxis)

Defined in: [src/artifacts/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L138)

Declare the rows' time axis (see [ArtifactMeta.timeAxis](/docs/api/interfaces/ArtifactMeta#timeaxis)).
