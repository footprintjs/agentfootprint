[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / gcsArtifacts

# Function: gcsArtifacts()

> **gcsArtifacts**(`options`): [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

Defined in: [src/artifacts/gcsArtifacts.ts:290](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/gcsArtifacts.ts#L290)

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
