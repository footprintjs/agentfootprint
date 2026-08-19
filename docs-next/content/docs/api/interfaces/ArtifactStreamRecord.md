---
title: ArtifactStreamRecord
---

# Interface: ArtifactStreamRecord

Defined in: [src/artifacts/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L214)

What `getStream` returns when the ref resolves: the ticket, and the
 payload's CANONICAL BYTES as a stream — the same bytes `meta.bytes` counts
 and a digest would cover, never a re-encoding.

 `meta.digest` (when the artifact carries one) describes these bytes but has
 NOT been checked against them: verification needs the whole payload, which
 is what this shape exists to avoid holding. It rides anyway so a caller who
 needs the guarantee can hash what it collected and compare — the loss is
 named, never silently traded. `get` remains the verifying read.

## Properties

### body

> `readonly` **body**: `ReadableStream`\<`Uint8Array`\>

Defined in: [src/artifacts/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L216)

***

### meta

> `readonly` **meta**: [`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta)

Defined in: [src/artifacts/types.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L215)
