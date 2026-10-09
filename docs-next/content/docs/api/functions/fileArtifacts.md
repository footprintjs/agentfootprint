---
title: fileArtifacts
---

# Function: fileArtifacts()

> **fileArtifacts**(`options`): [`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

Defined in: [src/artifacts/fileArtifacts.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L126)

A directory-backed artifact store — durable across restarts, legible to a
human, one file per artifact.

## Parameters

### options

[`FileArtifactsOptions`](/docs/api/interfaces/FileArtifactsOptions)

## Returns

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

## Example

```ts
const store = fileArtifacts({ directory: './artifacts' });
  const agent = Agent.create({ provider, artifacts: store });
```
