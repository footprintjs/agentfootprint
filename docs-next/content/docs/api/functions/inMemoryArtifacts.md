---
title: inMemoryArtifacts
---

# Function: inMemoryArtifacts()

> **inMemoryArtifacts**(`options?`): [`InMemoryArtifacts`](/docs/api/interfaces/InMemoryArtifacts)

Defined in: src/artifacts/inMemoryArtifacts.ts:102

A bounded, drop-counting, per-scope-isolated artifact store in process
memory.

## Parameters

### options?

[`InMemoryArtifactsOptions`](/docs/api/interfaces/InMemoryArtifactsOptions) = `{}`

## Returns

[`InMemoryArtifacts`](/docs/api/interfaces/InMemoryArtifacts)

## Example

```ts
const store = inMemoryArtifacts({ retention: { ttlMs: 15 * 60_000 } });
  const agent = Agent.create({ provider, artifacts: store });
```
