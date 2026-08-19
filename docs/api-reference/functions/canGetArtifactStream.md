[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / canGetArtifactStream

# Function: canGetArtifactStream()

> **canGetArtifactStream**(`store`): `store is GetStreamingArtifactStore`

Defined in: [src/artifacts/streaming.ts:98](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/streaming.ts#L98)

Can this store hand back a stream? Narrowing type guard.

Note what the streamed read does NOT carry: `get` re-verifies a `digest`
before returning, `getStream` cannot (see the header) — it bounds memory,
not integrity. Branching to `getStream` for a digested artifact is a
deliberate trade, and the ticket keeps the digest so a caller who needs the
guarantee can make it themselves.

## Parameters

### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

## Returns

`store is GetStreamingArtifactStore`
