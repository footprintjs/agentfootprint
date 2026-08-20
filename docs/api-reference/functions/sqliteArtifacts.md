[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / sqliteArtifacts

# Function: sqliteArtifacts()

> **sqliteArtifacts**(`options`): [`SqliteArtifacts`](/agentfootprint/api/generated/interfaces/SqliteArtifacts.md)

Defined in: [src/artifacts/sqliteArtifacts.ts:185](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/sqliteArtifacts.ts#L185)

An artifact store in one SQLite file — durable across restarts, crash-safe
under WAL, and the natural neighbour of `sqliteSessions({ file })`.

## Parameters

### options

[`SqliteArtifactsOptions`](/agentfootprint/api/generated/interfaces/SqliteArtifactsOptions.md)

## Returns

[`SqliteArtifacts`](/agentfootprint/api/generated/interfaces/SqliteArtifacts.md)

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
