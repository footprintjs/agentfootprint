---
title: ToolArtifacts
---

# Interface: ToolArtifacts

Defined in: [src/artifacts/capability.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L46)

The capability on `ctx.artifacts` — the store's five verbs with the scope
already answered.

## Methods

### delete()

> **delete**(`ref`): `Promise`\<`void`\>

Defined in: [src/artifacts/capability.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L54)

Remove one artifact this scope holds.

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`ref`): `Promise`\<[`ArtifactRecord`](/docs/api/interfaces/ArtifactRecord) \| `null`\>

Defined in: [src/artifacts/capability.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L52)

Ticket + payload. `null` for missing-or-expired; a digest mismatch throws.

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactRecord`](/docs/api/interfaces/ArtifactRecord) \| `null`\>

***

### head()

> **head**(`ref`): `Promise`\<[`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta) \| `null`\>

Defined in: [src/artifacts/capability.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L50)

The ticket without the payload. `null` for missing-or-expired.

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<[`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta) \| `null`\>

***

### list()

> **list**(`options?`): `Promise`\<[`ArtifactListResult`](/docs/api/interfaces/ArtifactListResult)\>

Defined in: [src/artifacts/capability.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L56)

Page through this scope's tickets, newest first.

#### Parameters

##### options?

[`ArtifactListOptions`](/docs/api/interfaces/ArtifactListOptions)

#### Returns

`Promise`\<[`ArtifactListResult`](/docs/api/interfaces/ArtifactListResult)\>

***

### put()

> **put**(`input`): `Promise`\<[`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta)\>

Defined in: [src/artifacts/capability.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L48)

Store a payload under this run's scope; returns the claim ticket.

#### Parameters

##### input

[`ToolArtifactPutInput`](/docs/api/type-aliases/ToolArtifactPutInput)

#### Returns

`Promise`\<[`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta)\>
