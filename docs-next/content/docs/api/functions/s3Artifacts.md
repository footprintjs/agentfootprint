---
title: s3Artifacts
---

# Function: s3Artifacts()

> **s3Artifacts**(`options`): [`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

Defined in: [src/artifacts/s3Artifacts.ts:314](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/s3Artifacts.ts#L314)

An artifact store in an S3 bucket.

## Parameters

### options

[`S3ArtifactsOptions`](/docs/api/interfaces/S3ArtifactsOptions)

## Returns

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

## Example

```ts
const store = s3Artifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts' });
  const agent = Agent.create({ provider, artifacts: store });
```
