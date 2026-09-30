---
title: ArtifactListOptions
---

# Interface: ArtifactListOptions

Defined in: [src/artifacts/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L170)

Options for `list` — the cursor convention `MemoryStore.list` set.

## Properties

### cursor?

> `readonly` `optional` **cursor?**: `string`

Defined in: [src/artifacts/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L172)

Continuation token from a previous page. Omit for the first page.

***

### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: [src/artifacts/types.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L174)

Maximum rows this page. Adapters may cap it lower.
