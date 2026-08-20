[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamingArtifactStore

# Type Alias: StreamingArtifactStore

> **StreamingArtifactStore** = [`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md) & `Required`\<`Pick`\<[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md), `"putStream"` \| `"getStream"`\>\>

Defined in: [src/artifacts/streaming.ts:74](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/streaming.ts#L74)

An [ArtifactStore](/agentfootprint/api/generated/interfaces/ArtifactStore.md) that implements BOTH streaming members.
