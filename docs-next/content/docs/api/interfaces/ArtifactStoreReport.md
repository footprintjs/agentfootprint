---
title: ArtifactStoreReport
---

# Interface: ArtifactStoreReport

Defined in: src/artifacts/conformance/types.ts:207

What one store's whole run came to.

## Properties

### declared

> `readonly` **declared**: `number`

Defined in: src/artifacts/conformance/types.ts:213

***

### failed

> `readonly` **failed**: `number`

Defined in: src/artifacts/conformance/types.ts:214

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: src/artifacts/conformance/types.ts:212

***

### ok

> `readonly` **ok**: `boolean`

Defined in: src/artifacts/conformance/types.ts:218

True when nothing failed. Declarations do not make a store
 non-conformant — they make it conformant WITH STATED LIMITS, which is a
 different claim, and the report prints both.

***

### outcomes

> `readonly` **outcomes**: readonly [`ArtifactStoreOutcome`](/docs/api/type-aliases/ArtifactStoreOutcome)[]

Defined in: src/artifacts/conformance/types.ts:210

***

### passed

> `readonly` **passed**: `number`

Defined in: src/artifacts/conformance/types.ts:211

***

### store

> `readonly` **store**: `string`

Defined in: src/artifacts/conformance/types.ts:209

The harness name.
