[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / fileArtifacts

# Function: fileArtifacts()

> **fileArtifacts**(`options`): [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

Defined in: [src/artifacts/fileArtifacts.ts:126](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/fileArtifacts.ts#L126)

A directory-backed artifact store — durable across restarts, legible to a
human, one file per artifact.

## Parameters

### options

[`FileArtifactsOptions`](/agentfootprint/api/generated/interfaces/FileArtifactsOptions.md)

## Returns

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

## Example

```ts
const store = fileArtifacts({ directory: './artifacts' });
  const agent = Agent.create({ provider, artifacts: store });
```
