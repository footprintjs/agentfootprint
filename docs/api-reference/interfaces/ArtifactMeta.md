[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactMeta

# Interface: ArtifactMeta

Defined in: [src/artifacts/types.ts:78](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L78)

The claim ticket's description — what a consumer needs to DECIDE, never the
bytes. This is what `head` returns, what `list` rows are, and what every
`artifacts.*` event carries (events never carry payloads).

## Properties

### bytes

> `readonly` **bytes**: `number`

Defined in: [src/artifacts/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L87)

Payload size in bytes (UTF-8 for text/JSON, byteLength for binary).

***

### createdAt

> `readonly` **createdAt**: `number`

Defined in: [src/artifacts/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L109)

Unix ms when the artifact was stored.

***

### digest?

> `readonly` `optional` **digest?**: `string`

Defined in: [src/artifacts/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L93)

`sha-256:<hex>` — integrity + idempotent re-put detection, computed at
 `put` when asked. Metadata, NEVER the key. Verified on `get`; a mismatch
 is a teaching refusal, never silent corruption.

***

### expiresAt?

> `readonly` `optional` **expiresAt?**: `number`

Defined in: [src/artifacts/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L97)

Unix ms when this artifact stops resolving — STATED at mint (from the
 store's ttl or the caller's own value, whichever is sooner), so consumers
 can reason about expiry instead of discovering it. Absent = no expiry.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/artifacts/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L83)

Consumer vocabulary — what this IS to whoever redeems it:
 `'dataset/rows'`, `'chart/spec'`, `'report/csv'`. Declared by the
 producer, never inferred.

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L89)

The human name: `"Q3 sales by region"`.

***

### mediaType

> `readonly` **mediaType**: `string`

Defined in: [src/artifacts/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L85)

MIME type of the payload: `'application/json'`, `'text/csv'`, …

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/agentfootprint/api/generated/interfaces/ArtifactOrigin.md)

Defined in: [src/artifacts/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L99)

The join to the causal record.

***

### parentRefs?

> `readonly` `optional` **parentRefs?**: readonly `string`[]

Defined in: [src/artifacts/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L107)

Derivation FACTS — the refs this artifact was computed from. Validated at
mint: naming a parent that does not resolve in the same scope is a
refusal (a foreign key that cannot dangle at birth). Deliberately NOT a
lineage-graph engine: walking parents is the consumer's fold over
`head()`, and causation stays the trace's job.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L79)
