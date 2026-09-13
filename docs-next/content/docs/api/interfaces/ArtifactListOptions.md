---
title: ArtifactListOptions
---

# Interface: ArtifactListOptions

Defined in: src/artifacts/types.ts:162

Options for `list` — the cursor convention `MemoryStore.list` set.

## Properties

### cursor?

> `readonly` `optional` **cursor?**: `string`

Defined in: src/artifacts/types.ts:164

Continuation token from a previous page. Omit for the first page.

***

### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: src/artifacts/types.ts:166

Maximum rows this page. Adapters may cap it lower.
