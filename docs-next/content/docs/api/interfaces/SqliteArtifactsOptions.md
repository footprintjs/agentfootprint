---
title: SqliteArtifactsOptions
---

# Interface: SqliteArtifactsOptions

Defined in: [src/artifacts/sqliteArtifacts.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L84)

Options for [sqliteArtifacts](/docs/api/functions/sqliteArtifacts).

## Properties

### busyTimeoutMs?

> `readonly` `optional` **busyTimeoutMs?**: `number`

Defined in: [src/artifacts/sqliteArtifacts.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L93)

How long a write waits for another writer's lock before failing loudly.
 Default 5000 ms.

***

### file

> `readonly` **file**: `string`

Defined in: [src/artifacts/sqliteArtifacts.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L87)

The database file. Created if missing, parent directory included.
 `':memory:'` is refused — use `inMemoryArtifacts()`, it says so in its name.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/sqliteArtifacts.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L90)

Retention dials — optional here: disk is a budget the operator owns.
 Budget evictions are least-recently-ACCESSED first (reads refresh recency).
