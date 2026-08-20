[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArtifacts

# Interface: ToolArtifacts

Defined in: [src/artifacts/capability.ts:46](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L46)

The capability on `ctx.artifacts` — the store's five verbs with the scope
already answered.

## Methods

### delete()

> **delete**(`ref`): `Promise`\<`void`\>

Defined in: [src/artifacts/capability.ts:54](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L54)

Remove one artifact this scope holds.

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`ref`): `Promise`\<[`ArtifactRecord`](/agentfootprint/api/generated/interfaces/ArtifactRecord.md) \| `null`\>

Defined in: [src/artifacts/capability.ts:52](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L52)

Ticket + payload. `null` for missing-or-expired; a digest mismatch throws.

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactRecord`](/agentfootprint/api/generated/interfaces/ArtifactRecord.md) \| `null`\>

***

### head()

> **head**(`ref`): `Promise`\<[`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md) \| `null`\>

Defined in: [src/artifacts/capability.ts:50](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L50)

The ticket without the payload. `null` for missing-or-expired.

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md) \| `null`\>

***

### list()

> **list**(`options?`): `Promise`\<[`ArtifactListResult`](/agentfootprint/api/generated/interfaces/ArtifactListResult.md)\>

Defined in: [src/artifacts/capability.ts:56](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L56)

Page through this scope's tickets, newest first.

#### Parameters

##### options?

[`ArtifactListOptions`](/agentfootprint/api/generated/interfaces/ArtifactListOptions.md)

#### Returns

`Promise`\<[`ArtifactListResult`](/agentfootprint/api/generated/interfaces/ArtifactListResult.md)\>

***

### put()

> **put**(`input`): `Promise`\<[`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md)\>

Defined in: [src/artifacts/capability.ts:48](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L48)

Store a payload under this run's scope; returns the claim ticket.

#### Parameters

##### input

[`ToolArtifactPutInput`](/agentfootprint/api/generated/type-aliases/ToolArtifactPutInput.md)

#### Returns

`Promise`\<[`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md)\>
