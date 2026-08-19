---
title: ArtifactStoreReport
---

# Interface: ArtifactStoreReport

Defined in: [src/artifacts/conformance/types.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L206)

What one store's whole run came to.

## Properties

### declared

> `readonly` **declared**: `number`

Defined in: [src/artifacts/conformance/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L212)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/artifacts/conformance/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L213)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/artifacts/conformance/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L211)

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [src/artifacts/conformance/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L217)

True when nothing failed. Declarations do not make a store
 non-conformant — they make it conformant WITH STATED LIMITS, which is a
 different claim, and the report prints both.

***

### outcomes

> `readonly` **outcomes**: readonly [`ArtifactStoreOutcome`](/docs/api/type-aliases/ArtifactStoreOutcome)[]

Defined in: [src/artifacts/conformance/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L209)

***

### passed

> `readonly` **passed**: `number`

Defined in: [src/artifacts/conformance/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L210)

***

### store

> `readonly` **store**: `string`

Defined in: [src/artifacts/conformance/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/types.ts#L208)

The harness name.
