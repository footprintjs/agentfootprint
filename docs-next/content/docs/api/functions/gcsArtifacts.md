---
title: gcsArtifacts
---

# Function: gcsArtifacts()

> **gcsArtifacts**(`options`): [`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

Defined in: src/artifacts/gcsArtifacts.ts:290

An artifact store in a Cloud Storage bucket.

## Parameters

### options

[`GcsArtifactsOptions`](/docs/api/interfaces/GcsArtifactsOptions)

## Returns

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

## Example

```ts
const store = gcsArtifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts' });
  const agent = Agent.create({ provider, artifacts: store });
```
