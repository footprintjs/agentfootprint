[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / fileArtifacts

# Function: fileArtifacts()

> **fileArtifacts**(`options`): [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

Defined in: [src/artifacts/fileArtifacts.ts:126](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/fileArtifacts.ts#L126)

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
