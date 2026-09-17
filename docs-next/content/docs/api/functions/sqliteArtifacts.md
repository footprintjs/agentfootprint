---
title: sqliteArtifacts
---

# Function: sqliteArtifacts()

> **sqliteArtifacts**(`options`): [`SqliteArtifacts`](/docs/api/interfaces/SqliteArtifacts)

Defined in: [src/artifacts/sqliteArtifacts.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sqliteArtifacts.ts#L185)

An artifact store in one SQLite file — durable across restarts, crash-safe
under WAL, and the natural neighbour of `sqliteSessions({ file })`.

## Parameters

### options

[`SqliteArtifactsOptions`](/docs/api/interfaces/SqliteArtifactsOptions)

## Returns

[`SqliteArtifacts`](/docs/api/interfaces/SqliteArtifacts)

## Throws

SqliteUnavailableError when the running Node has no `node:sqlite`.

## Throws

UnreadableArtifactStoreError when the file exists but cannot be used.

## Example

```ts
const agent = Agent.create({
    provider,
    artifacts: sqliteArtifacts({ file: './data/artifacts.db' }),
  });
```
