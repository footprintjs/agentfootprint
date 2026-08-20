[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / canPutArtifactStream

# Function: canPutArtifactStream()

> **canPutArtifactStream**(`store`): `store is PutStreamingArtifactStore`

Defined in: [src/artifacts/streaming.ts:85](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/streaming.ts#L85)

Can this store take a streamed put? Narrowing type guard — the answer is
the type, so a consumer branches once and the compiler carries it.

## Parameters

### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

## Returns

`store is PutStreamingArtifactStore`

## Example

```ts
if (canPutArtifactStream(store)) await store.putStream(scope, input, body);
  else await store.put(scope, { ...input, data: await collect(body) });
```
