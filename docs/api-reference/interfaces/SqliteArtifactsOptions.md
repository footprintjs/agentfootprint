[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SqliteArtifactsOptions

# Interface: SqliteArtifactsOptions

Defined in: [src/artifacts/sqliteArtifacts.ts:82](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/sqliteArtifacts.ts#L82)

Options for [sqliteArtifacts](/agentfootprint/api/generated/functions/sqliteArtifacts.md).

## Properties

### busyTimeoutMs?

> `readonly` `optional` **busyTimeoutMs?**: `number`

Defined in: [src/artifacts/sqliteArtifacts.ts:91](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/sqliteArtifacts.ts#L91)

How long a write waits for another writer's lock before failing loudly.
 Default 5000 ms.

***

### file

> `readonly` **file**: `string`

Defined in: [src/artifacts/sqliteArtifacts.ts:85](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/sqliteArtifacts.ts#L85)

The database file. Created if missing, parent directory included.
 `':memory:'` is refused — use `inMemoryArtifacts()`, it says so in its name.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/agentfootprint/api/generated/interfaces/ArtifactRetention.md)

Defined in: [src/artifacts/sqliteArtifacts.ts:88](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/sqliteArtifacts.ts#L88)

Retention dials — optional here: disk is a budget the operator owns.
 Budget evictions are least-recently-ACCESSED first (reads refresh recency).
