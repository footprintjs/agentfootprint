[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / inMemoryArtifacts

# Function: inMemoryArtifacts()

> **inMemoryArtifacts**(`options?`): [`InMemoryArtifacts`](/agentfootprint/api/generated/interfaces/InMemoryArtifacts.md)

Defined in: [src/artifacts/inMemoryArtifacts.ts:102](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/inMemoryArtifacts.ts#L102)

A bounded, drop-counting, per-scope-isolated artifact store in process
memory.

## Parameters

### options?

[`InMemoryArtifactsOptions`](/agentfootprint/api/generated/interfaces/InMemoryArtifactsOptions.md) = `{}`

## Returns

[`InMemoryArtifacts`](/agentfootprint/api/generated/interfaces/InMemoryArtifacts.md)

## Example

```ts
const store = inMemoryArtifacts({ retention: { ttlMs: 15 * 60_000 } });
  const agent = Agent.create({ provider, artifacts: store });
```
