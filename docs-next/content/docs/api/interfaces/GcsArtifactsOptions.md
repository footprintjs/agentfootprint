---
title: GcsArtifactsOptions
---

# Interface: GcsArtifactsOptions

Defined in: [src/artifacts/gcsArtifacts.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L211)

Options for [gcsArtifacts](/docs/api/functions/gcsArtifacts).

## Properties

### bucket

> `readonly` **bucket**: `string`

Defined in: [src/artifacts/gcsArtifacts.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L213)

The bucket. It must already exist — this library never creates one.

***

### prefix?

> `readonly` `optional` **prefix?**: `string`

Defined in: [src/artifacts/gcsArtifacts.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L215)

Object-name prefix inside the bucket, so a bucket can be shared.

***

### projectId?

> `readonly` `optional` **projectId?**: `string`

Defined in: [src/artifacts/gcsArtifacts.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L218)

Project id for the client this factory builds. Ignored when `storage` is
 passed — that client's configuration is yours.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/gcsArtifacts.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L222)

Retention dials. Budgets evict OLDEST-first (no cheap read-recency).

***

### storage?

> `readonly` `optional` **storage?**: `GcsStorageLike`

Defined in: [src/artifacts/gcsArtifacts.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L220)

Your own pre-built client; configuration and credentials stay yours.
