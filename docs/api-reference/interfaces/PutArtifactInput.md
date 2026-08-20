[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PutArtifactInput

# Interface: PutArtifactInput

Defined in: [src/artifacts/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L114)

What `put` takes — everything on [ArtifactMeta](/agentfootprint/api/generated/interfaces/ArtifactMeta.md) the CALLER owns.
 `ref`, `bytes`, `digest` and `createdAt` are the store's to stamp.

## Properties

### data

> `readonly` **data**: `unknown`

Defined in: [src/artifacts/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L123)

The payload. Strings and `Uint8Array` are stored byte-for-byte; any other
value must be JSON-serializable (it is measured, digested and — in the
durable adapters — persisted via JSON). A value JSON cannot carry is
refused at `put` by name, never stored as an approximation.

***

### digest?

> `readonly` `optional` **digest?**: `"sha-256"`

Defined in: [src/artifacts/types.ts:126](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L126)

Ask for an integrity digest, computed by the store at put.

***

### expiresAt?

> `readonly` `optional` **expiresAt?**: `number`

Defined in: [src/artifacts/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L128)

Caller-stated expiry (unix ms). The store's own ttl may only TIGHTEN it.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L115)

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L124)

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L116)

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/agentfootprint/api/generated/interfaces/ArtifactOrigin.md)

Defined in: [src/artifacts/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L129)

***

### parentRefs?

> `readonly` `optional` **parentRefs?**: readonly `string`[]

Defined in: [src/artifacts/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L130)
