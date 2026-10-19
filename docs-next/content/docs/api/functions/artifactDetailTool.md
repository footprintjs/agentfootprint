---
title: artifactDetailTool
---

# Function: artifactDetailTool()

> **artifactDetailTool**(`options`): [`Tool`](/docs/api/interfaces/Tool)\<[`ArtifactDetailArgs`](/docs/api/interfaces/ArtifactDetailArgs), [`ArtifactDetailResult`](/docs/api/type-aliases/ArtifactDetailResult)\>

Defined in: [src/tools/artifactDetailTool.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactDetailTool.ts#L33)

Open bounded JSON sections through a host-authenticated reference.

The host owns scope, run, source, kind, integrity and domain checks in `admit`.
This helper never reads a store automatically or grants claim authority. Every
call re-admits, then detaches/freezes at most 1 MiB of ordinary JSON (depth 100).
Paths have at most 16 segments and 2048 UTF-16 characters; pages contain at most
20 children. Whole responses are bounded to 12 KiB UTF-8, including at most
4 KiB host context; inline values are at most 8 KiB. Large scalars are omitted
whole. Bounds do not preempt synchronous host code or arbitrary Proxy traps.

Callback failures use fixed refusal text. Cancellation stops waiting and late
results cannot be served, but does not claim the underlying work stopped.

## Parameters

### options

[`ArtifactDetailOptions`](/docs/api/interfaces/ArtifactDetailOptions)

## Returns

[`Tool`](/docs/api/interfaces/Tool)\<[`ArtifactDetailArgs`](/docs/api/interfaces/ArtifactDetailArgs), [`ArtifactDetailResult`](/docs/api/type-aliases/ArtifactDetailResult)\>
