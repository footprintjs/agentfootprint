[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / gcsArtifacts

# Function: gcsArtifacts()

> **gcsArtifacts**(`options`): [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

Defined in: [src/artifacts/gcsArtifacts.ts:290](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/gcsArtifacts.ts#L290)

An artifact store in a Cloud Storage bucket.

## Parameters

### options

[`GcsArtifactsOptions`](/agentfootprint/api/generated/interfaces/GcsArtifactsOptions.md)

## Returns

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

## Example

```ts
const store = gcsArtifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts' });
  const agent = Agent.create({ provider, artifacts: store });
```
