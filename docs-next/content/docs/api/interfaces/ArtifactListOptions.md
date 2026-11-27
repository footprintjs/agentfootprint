---
title: ArtifactListOptions
---

# Interface: ArtifactListOptions

Defined in: [src/artifacts/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L177)

Options for `list` — the cursor convention `MemoryStore.list` set.

## Properties

### cursor?

> `readonly` `optional` **cursor?**: `string`

Defined in: [src/artifacts/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L179)

Continuation token from a previous page. Omit for the first page.

***

### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: [src/artifacts/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L181)

Maximum rows this page. Adapters may cap it lower.
