[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / resolveSurfaceMode

# Function: resolveSurfaceMode()

> **resolveSurfaceMode**(`provider`, `model?`): [`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md)

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:166](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/injection-engine/factories/defineSkill.ts#L166)

Resolve `surfaceMode: 'auto'` to a concrete mode based on provider
+ model. The defaults match the per-provider attention profile
documented in the Skills, explained essay:

  - Claude >= 3.5  → 'both'      (cheap to cache, high adherence)
  - Claude pre-3.5 → 'tool-only' (recency-first more reliable)
  - OpenAI / Bedrock / Ollama / Mock / unknown → 'tool-only'

Pure function — no side effects. Consumers can call directly to
inspect what `'auto'` will resolve to in their stack.

## Parameters

### provider

`string`

### model?

`string`

## Returns

[`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md)
