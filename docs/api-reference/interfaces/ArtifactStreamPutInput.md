[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactStreamPutInput

# Interface: ArtifactStreamPutInput

Defined in: [src/artifacts/types.ts:193](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L193)

What a STREAMED put declares. Everything on [PutArtifactInput](/agentfootprint/api/generated/interfaces/PutArtifactInput.md) the
caller owns, minus the two things a store cannot honor without holding the
payload whole:

  • **`bytes` is REQUIRED here** (it is stamped, not measured). Retention
    has to plan an eviction BEFORE the bytes arrive, and an object store
    has to declare a content length before it opens the upload — neither
    can wait for a stream to end. A store that can see the true count
    verifies it and refuses a mismatch by name rather than storing a meta
    that lies about its own payload.
  • **there is no `digest`.** A digest is computed over the whole canonical
    payload with the same primitive every adapter shares; a store that
    never holds the payload cannot produce one, and an incremental hash
    computed a second way would be a different promise wearing the same
    field name. Digest the source yourself, or use `put`.

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/types.ts:197](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L197)

The payload's exact byte length — stated by the producer, not measured.

***

### expiresAt?

> `readonly` `optional` **expiresAt?**: `number`

Defined in: [src/artifacts/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L200)

Caller-stated expiry (unix ms). The store's own ttl may only TIGHTEN it.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L194)

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L198)

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/types.ts:195](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L195)

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/agentfootprint/api/generated/interfaces/ArtifactOrigin.md)

Defined in: [src/artifacts/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L201)

***

### parentRefs?

> `readonly` `optional` **parentRefs?**: readonly `string`[]

Defined in: [src/artifacts/types.ts:202](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L202)
