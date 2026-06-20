---
title: resolveSurfaceMode
---

# Function: resolveSurfaceMode()

> **resolveSurfaceMode**(`provider`, `model?`): [`SurfaceMode`](/docs/api/type-aliases/SurfaceMode)

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineSkill.ts#L166)

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

[`SurfaceMode`](/docs/api/type-aliases/SurfaceMode)
