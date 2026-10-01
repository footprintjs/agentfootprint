---
title: ArtifactStoreReport
---

# Interface: ArtifactStoreReport

Defined in: [src/artifacts/conformance/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L207)

What one store's whole run came to.

## Properties

### declared

> `readonly` **declared**: `number`

Defined in: [src/artifacts/conformance/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L213)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/artifacts/conformance/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L214)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/artifacts/conformance/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L212)

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [src/artifacts/conformance/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L218)

True when nothing failed. Declarations do not make a store
 non-conformant — they make it conformant WITH STATED LIMITS, which is a
 different claim, and the report prints both.

***

### outcomes

> `readonly` **outcomes**: readonly [`ArtifactStoreOutcome`](/docs/api/type-aliases/ArtifactStoreOutcome)[]

Defined in: [src/artifacts/conformance/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L210)

***

### passed

> `readonly` **passed**: `number`

Defined in: [src/artifacts/conformance/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L211)

***

### store

> `readonly` **store**: `string`

Defined in: [src/artifacts/conformance/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L209)

The harness name.
