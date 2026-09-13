---
title: ArtifactStoreReport
---

# Interface: ArtifactStoreReport

Defined in: src/artifacts/conformance/types.ts:206

What one store's whole run came to.

## Properties

### declared

> `readonly` **declared**: `number`

Defined in: src/artifacts/conformance/types.ts:212

***

### failed

> `readonly` **failed**: `number`

Defined in: src/artifacts/conformance/types.ts:213

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: src/artifacts/conformance/types.ts:211

***

### ok

> `readonly` **ok**: `boolean`

Defined in: src/artifacts/conformance/types.ts:217

True when nothing failed. Declarations do not make a store
 non-conformant — they make it conformant WITH STATED LIMITS, which is a
 different claim, and the report prints both.

***

### outcomes

> `readonly` **outcomes**: readonly [`ArtifactStoreOutcome`](/docs/api/type-aliases/ArtifactStoreOutcome)[]

Defined in: src/artifacts/conformance/types.ts:209

***

### passed

> `readonly` **passed**: `number`

Defined in: src/artifacts/conformance/types.ts:210

***

### store

> `readonly` **store**: `string`

Defined in: src/artifacts/conformance/types.ts:208

The harness name.
