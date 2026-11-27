---
title: GcsArtifactsOptions
---

# Interface: GcsArtifactsOptions

Defined in: [src/artifacts/gcsArtifacts.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L206)

Options for [gcsArtifacts](/docs/api/functions/gcsArtifacts).

## Properties

### bucket

> `readonly` **bucket**: `string`

Defined in: [src/artifacts/gcsArtifacts.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L208)

The bucket. It must already exist — this library never creates one.

***

### prefix?

> `readonly` `optional` **prefix?**: `string`

Defined in: [src/artifacts/gcsArtifacts.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L210)

Object-name prefix inside the bucket, so a bucket can be shared.

***

### projectId?

> `readonly` `optional` **projectId?**: `string`

Defined in: [src/artifacts/gcsArtifacts.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L213)

Project id for the client this factory builds. Ignored when `storage` is
 passed — that client's configuration is yours.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/gcsArtifacts.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L217)

Retention dials. Budgets evict OLDEST-first (no cheap read-recency).

***

### storage?

> `readonly` `optional` **storage?**: `GcsStorageLike`

Defined in: [src/artifacts/gcsArtifacts.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/gcsArtifacts.ts#L215)

Your own pre-built client; configuration and credentials stay yours.
