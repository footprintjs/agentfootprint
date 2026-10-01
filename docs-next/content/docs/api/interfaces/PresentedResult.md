---
title: PresentedResult
---

# Interface: PresentedResult

Defined in: src/artifacts/present.ts:54

The one result shape a successful `present` returns (stringified onto the
 `role: 'tool'` message — a reload walks history for exactly this).

## Properties

### as

> `readonly` **as**: `string`

Defined in: src/artifacts/present.ts:60

The consumer vocabulary the model chose — stored as data (the component
 registry that would validate it is a later phase).

***

### presented

> `readonly` **presented**: `true`

Defined in: src/artifacts/present.ts:56

Always `true`. The field a transcript walker branches on.

***

### ref

> `readonly` **ref**: `string`

Defined in: src/artifacts/present.ts:57

***

### snapshot

> `readonly` **snapshot**: [`PresentSnapshot`](/docs/api/interfaces/PresentSnapshot)

Defined in: src/artifacts/present.ts:61
