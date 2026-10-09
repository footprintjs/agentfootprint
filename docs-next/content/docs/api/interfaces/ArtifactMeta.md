---
title: ArtifactMeta
---

# Interface: ArtifactMeta

Defined in: [src/artifacts/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L79)

The claim ticket's description — what a consumer needs to DECIDE, never the
bytes. This is what `head` returns, what `list` rows are, and what every
`artifacts.*` event carries (events never carry payloads).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L88)

Payload size in bytes (UTF-8 for text/JSON, byteLength for binary).

***

### createdAt

> `readonly` **createdAt**: `number`

Defined in: [src/artifacts/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L115)

Unix ms when the artifact was stored.

***

### digest?

> `readonly` `optional` **digest?**: `string`

Defined in: [src/artifacts/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L94)

`sha-256:<hex>` — integrity + idempotent re-put detection, computed at
 `put` when asked. Metadata, NEVER the key. Verified on `get`; a mismatch
 is a teaching refusal, never silent corruption.

***

### expiresAt?

> `readonly` `optional` **expiresAt?**: `number`

Defined in: [src/artifacts/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L98)

Unix ms when this artifact stops resolving — STATED at mint (from the
 store's ttl or the caller's own value, whichever is sooner), so consumers
 can reason about expiry instead of discovering it. Absent = no expiry.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L84)

Consumer vocabulary — what this IS to whoever redeems it:
 `'dataset/rows'`, `'chart/spec'`, `'report/csv'`. Declared by the
 producer, never inferred.

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L90)

The human name: `"Q3 sales by region"`.

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L86)

MIME type of the payload: `'application/json'`, `'text/csv'`, …

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/docs/api/interfaces/ArtifactOrigin)

Defined in: [src/artifacts/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L100)

The join to the causal record.

***

### parentRefs?

> `readonly` `optional` **parentRefs?**: readonly `string`[]

Defined in: [src/artifacts/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L108)

Derivation FACTS — the refs this artifact was computed from. Validated at
mint: naming a parent that does not resolve in the same scope is a
refusal (a foreign key that cannot dangle at birth). Deliberately NOT a
lineage-graph engine: walking parents is the consumer's fold over
`head()`, and causation stays the trace's job.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L80)

***

### timeAxis?

> `readonly` `optional` **timeAxis?**: [`DatasetTimeAxis`](/docs/api/interfaces/DatasetTimeAxis)

Defined in: [src/artifacts/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L113)

The rows' TIME AXIS as the producer declared it — which column is time,
 how its values are written, and how each row summarises its interval.
 Validated at mint (a malformed one is refused, never repaired); absent =
 undeclared, and a consumer keeps its own heuristic. See `core/time/axis.ts`.
