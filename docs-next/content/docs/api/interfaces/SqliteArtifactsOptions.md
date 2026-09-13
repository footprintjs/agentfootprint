---
title: SqliteArtifactsOptions
---

# Interface: SqliteArtifactsOptions

Defined in: src/artifacts/sqliteArtifacts.ts:82

Options for [sqliteArtifacts](/docs/api/functions/sqliteArtifacts).

## Properties

### busyTimeoutMs?

> `readonly` `optional` **busyTimeoutMs?**: `number`

Defined in: src/artifacts/sqliteArtifacts.ts:91

How long a write waits for another writer's lock before failing loudly.
 Default 5000 ms.

***

### file

> `readonly` **file**: `string`

Defined in: src/artifacts/sqliteArtifacts.ts:85

The database file. Created if missing, parent directory included.
 `':memory:'` is refused — use `inMemoryArtifacts()`, it says so in its name.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: src/artifacts/sqliteArtifacts.ts:88

Retention dials — optional here: disk is a budget the operator owns.
 Budget evictions are least-recently-ACCESSED first (reads refresh recency).
