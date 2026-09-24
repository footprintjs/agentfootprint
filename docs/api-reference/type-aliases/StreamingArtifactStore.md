[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamingArtifactStore

# Type Alias: StreamingArtifactStore

> **StreamingArtifactStore** = [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md) & `Required`\<`Pick`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md), `"putStream"` \| `"getStream"`\>\>

Defined in: [src/artifacts/streaming.ts:74](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/streaming.ts#L74)

An [ArtifactStore](/agentfootprint/api/generated/interfaces/ArtifactStore.md) that implements BOTH streaming members.
