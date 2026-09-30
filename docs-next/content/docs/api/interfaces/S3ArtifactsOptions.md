---
title: S3ArtifactsOptions
---

# Interface: S3ArtifactsOptions

Defined in: [src/artifacts/s3Artifacts.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L178)

Options for [s3Artifacts](/docs/api/functions/s3Artifacts).

## Properties

### bucket

> `readonly` **bucket**: `string`

Defined in: [src/artifacts/s3Artifacts.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L180)

The bucket. It must already exist — this library never creates one.

***

### client?

> `readonly` `optional` **client?**: `S3ArtifactsClientLike`

Defined in: [src/artifacts/s3Artifacts.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L188)

Your own pre-built client; configuration and credentials stay yours.

***

### prefix?

> `readonly` `optional` **prefix?**: `string`

Defined in: [src/artifacts/s3Artifacts.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L183)

Key prefix inside the bucket, so a bucket can be shared. The scope
 layout starts under it. Absent = at the root of the bucket.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: [src/artifacts/s3Artifacts.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L186)

Region for the client this factory builds. Ignored when `client` is
 passed — that client's configuration is yours.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/s3Artifacts.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L192)

Retention dials. Budgets evict OLDEST-first here: S3 has no cheap
 read-recency, the same statement `fileArtifacts` makes about a
 directory.
