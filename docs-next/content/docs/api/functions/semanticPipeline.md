---
title: semanticPipeline
---

# Function: semanticPipeline()

> **semanticPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/semantic.ts:98](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/pipeline/semantic.ts#L98)

Build the semantic read + write pipelines sharing a single store.
Returns `{ read, write }` ready to pass to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`SemanticPipelineConfig`

## Returns

`MemoryPipeline`
