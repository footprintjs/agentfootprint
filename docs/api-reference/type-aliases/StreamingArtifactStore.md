[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamingArtifactStore

# Type Alias: StreamingArtifactStore

> **StreamingArtifactStore** = [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md) & `Required`\<`Pick`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md), `"putStream"` \| `"getStream"`\>\>

Defined in: [src/artifacts/streaming.ts:74](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/streaming.ts#L74)

An [ArtifactStore](/agentfootprint/api/generated/interfaces/ArtifactStore.md) that implements BOTH streaming members.
