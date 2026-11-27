---
title: S3ArtifactsOptions
---

# Interface: S3ArtifactsOptions

Defined in: [src/artifacts/s3Artifacts.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L173)

Options for [s3Artifacts](/docs/api/functions/s3Artifacts).

## Properties

### bucket

> `readonly` **bucket**: `string`

Defined in: [src/artifacts/s3Artifacts.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L175)

The bucket. It must already exist — this library never creates one.

***

### client?

> `readonly` `optional` **client?**: `S3ArtifactsClientLike`

Defined in: [src/artifacts/s3Artifacts.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L183)

Your own pre-built client; configuration and credentials stay yours.

***

### prefix?

> `readonly` `optional` **prefix?**: `string`

Defined in: [src/artifacts/s3Artifacts.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L178)

Key prefix inside the bucket, so a bucket can be shared. The scope
 layout starts under it. Absent = at the root of the bucket.

***

### region?

> `readonly` `optional` **region?**: `string`

Defined in: [src/artifacts/s3Artifacts.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L181)

Region for the client this factory builds. Ignored when `client` is
 passed — that client's configuration is yours.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/s3Artifacts.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L187)

Retention dials. Budgets evict OLDEST-first here: S3 has no cheap
 read-recency, the same statement `fileArtifacts` makes about a
 directory.
