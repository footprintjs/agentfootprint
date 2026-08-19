[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamingArtifactStore

# Type Alias: StreamingArtifactStore

> **StreamingArtifactStore** = [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md) & `Required`\<`Pick`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md), `"putStream"` \| `"getStream"`\>\>

Defined in: [src/artifacts/streaming.ts:74](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/streaming.ts#L74)

An [ArtifactStore](/agentfootprint/api/generated/interfaces/ArtifactStore.md) that implements BOTH streaming members.
