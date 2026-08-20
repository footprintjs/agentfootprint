[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamingArtifactStore

# Type Alias: StreamingArtifactStore

> **StreamingArtifactStore** = [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md) & `Required`\<`Pick`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md), `"putStream"` \| `"getStream"`\>\>

Defined in: [src/artifacts/streaming.ts:74](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/streaming.ts#L74)

An [ArtifactStore](/agentfootprint/api/generated/interfaces/ArtifactStore.md) that implements BOTH streaming members.
