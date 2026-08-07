[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalEvidence

# Interface: RetrievalEvidence

Defined in: [src/memory/retrieval/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L92)

Everything one retrieval knows about itself. Written to the memory
subflow's scope by `loadRelevant`, refined by `pickByBudget` and
`formatDefault`, and lifted to the PARENT scope by the read mount so
it lands in the root commit log where a slice can reach it.

## Properties

### admittedCount

> `readonly` **admittedCount**: `number`

Defined in: [src/memory/retrieval/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L116)

How many reached the prompt.

***

### candidates?

> `readonly` `optional` **candidates?**: readonly [`RetrievedCandidate`](/agentfootprint/api/generated/interfaces/RetrievedCandidate.md)[]

Defined in: [src/memory/retrieval/types.ts:126](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L126)

The candidates themselves, best-scoring first.

`undefined` means this store could not tell us — see
[candidatesOmittedReason](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#candidatesomittedreason). It never means "there were none";
that case is `[]` with `consideredCount: 0`.

***

### candidatesComplete

> `readonly` **candidatesComplete**: `boolean`

Defined in: [src/memory/retrieval/types.ts:135](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L135)

Whether [candidates](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#candidates) is the complete set of candidates that
existed, or only as far as the pool we asked for reached.

`false` does NOT weaken the admitted set — see the proof in
`loadRelevant`. It only means the REJECTED list is a sample: there
may be further below-threshold entries we never saw.

***

### candidatesOmittedReason?

> `readonly` `optional` **candidatesOmittedReason?**: `string`

Defined in: [src/memory/retrieval/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L137)

Present exactly when `candidates` is undefined.

***

### consideredCount

> `readonly` **consideredCount**: `number`

Defined in: [src/memory/retrieval/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L114)

How many candidates came back from the store.

***

### corpusEmpty

> `readonly` **corpusEmpty**: `boolean`

Defined in: [src/memory/retrieval/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L144)

The store returned nothing at all for this namespace. Distinct from
"everything scored below threshold" (`consideredCount > 0`), and the
distinction is the whole diagnosis: an empty namespace almost always
means the corpus was indexed somewhere else.

***

### dimensions?

> `readonly` `optional` **dimensions?**: `number`

Defined in: [src/memory/retrieval/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L110)

Length of the query vector. Mixing two lengths in one store is a config bug.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/memory/retrieval/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L108)

The embedder id the query was produced with, when the caller declared one.

***

### k

> `readonly` **k**: `number`

Defined in: [src/memory/retrieval/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L104)

How many chunks the retriever was willing to admit.

***

### memoryId?

> `readonly` `optional` **memoryId?**: `string`

Defined in: [src/memory/retrieval/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L94)

The retriever's id (`defineRAG({ id })`). Stamped by the read mount.

***

### namespace?

> `readonly` `optional` **namespace?**: `string`

Defined in: [src/memory/retrieval/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L146)

The namespace that was searched, as a plain string, for the diagnosis above.

***

### queryHash

> `readonly` **queryHash**: `string`

Defined in: [src/memory/retrieval/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L102)

A stable hash of the query text — NOT the text. The query is already
in the recording once (as `userMessage`); copying it into a second
key would widen the exposure surface for no new information, and any
redaction policy the host configured for the first copy would not
know about the second.

***

### rejectedCount

> `readonly` **rejectedCount**: `number`

Defined in: [src/memory/retrieval/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L118)

`consideredCount - admittedCount`.

***

### selectionOrder

> `readonly` **selectionOrder**: `"recency"` \| `"relevance"`

Defined in: [src/memory/retrieval/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L112)

How the budget picker ordered the admitted set. See the note on `rank`.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/memory/retrieval/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/memory/retrieval/types.ts#L106)

The quality floor. Absent when the retriever set none.
