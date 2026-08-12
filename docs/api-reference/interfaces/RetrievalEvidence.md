[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalEvidence

# Interface: RetrievalEvidence

Defined in: [src/memory/retrieval/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L103)

Everything one retrieval knows about itself. Written to the memory
subflow's scope by `loadRelevant`, refined by `pickByBudget` and
`formatDefault`, and lifted to the PARENT scope by the read mount so
it lands in the root commit log where a slice can reach it.

## Properties

### admittedCount

> `readonly` **admittedCount**: `number`

Defined in: [src/memory/retrieval/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L144)

How many reached the prompt.

***

### candidates?

> `readonly` `optional` **candidates?**: readonly [`RetrievedCandidate`](/agentfootprint/api/generated/interfaces/RetrievedCandidate.md)[]

Defined in: [src/memory/retrieval/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L154)

The candidates themselves, best-scoring first.

`undefined` means this store could not tell us — see
[candidatesOmittedReason](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#candidatesomittedreason). It never means "there were none";
that case is `[]` with `consideredCount: 0`.

***

### candidatesComplete

> `readonly` **candidatesComplete**: `boolean`

Defined in: [src/memory/retrieval/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L163)

Whether [candidates](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#candidates) is the complete set of candidates that
existed, or only as far as the pool we asked for reached.

`false` does NOT weaken the admitted set — see the proof in
`loadRelevant`. It only means the REJECTED list is a sample: there
may be further below-threshold entries we never saw.

***

### candidatesOmittedReason?

> `readonly` `optional` **candidatesOmittedReason?**: `string`

Defined in: [src/memory/retrieval/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L165)

Present exactly when `candidates` is undefined.

***

### charsUsed?

> `readonly` `optional` **charsUsed?**: `number`

Defined in: [src/memory/retrieval/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L134)

How many characters of PASSAGE the admitted set spends. Present exactly
when [maxChars](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#maxchars) is, and re-stated by the budget picker so it can
never disagree with [admittedCount](/agentfootprint/api/generated/interfaces/RetrievalEvidence.md#admittedcount).

Passage characters, not prompt bytes: the `<source …>` wrapper and the
block header are added later by the formatter and are not counted here.
The exact bytes are on each candidate's `promptFragment` once the
formatter has run.

***

### consideredCount

> `readonly` **consideredCount**: `number`

Defined in: [src/memory/retrieval/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L142)

How many candidates came back from the store.

***

### corpusEmpty

> `readonly` **corpusEmpty**: `boolean`

Defined in: [src/memory/retrieval/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L172)

The store returned nothing at all for this namespace. Distinct from
"everything scored below threshold" (`consideredCount > 0`), and the
distinction is the whole diagnosis: an empty namespace almost always
means the corpus was indexed somewhere else.

***

### dimensions?

> `readonly` `optional` **dimensions?**: `number`

Defined in: [src/memory/retrieval/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L138)

Length of the query vector. Mixing two lengths in one store is a config bug.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/memory/retrieval/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L136)

The embedder id the query was produced with, when the caller declared one.

***

### k

> `readonly` **k**: `number`

Defined in: [src/memory/retrieval/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L115)

How many chunks the retriever was willing to admit.

***

### maxChars?

> `readonly` `optional` **maxChars?**: `number`

Defined in: [src/memory/retrieval/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L123)

The character budget the admitted passages were spent against (8.19.0).
Absent when the retriever set none — which is the default, and means
`k` was the only bound on how much text reached the prompt.

***

### memoryId?

> `readonly` `optional` **memoryId?**: `string`

Defined in: [src/memory/retrieval/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L105)

The retriever's id (`defineRAG({ id })`). Stamped by the read mount.

***

### namespace?

> `readonly` `optional` **namespace?**: `string`

Defined in: [src/memory/retrieval/types.ts:174](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L174)

The namespace that was searched, as a plain string, for the diagnosis above.

***

### queryHash

> `readonly` **queryHash**: `string`

Defined in: [src/memory/retrieval/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L113)

A stable hash of the query text — NOT the text. The query is already
in the recording once (as `userMessage`); copying it into a second
key would widen the exposure surface for no new information, and any
redaction policy the host configured for the first copy would not
know about the second.

***

### rejectedCount

> `readonly` **rejectedCount**: `number`

Defined in: [src/memory/retrieval/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L146)

`consideredCount - admittedCount`.

***

### selectionOrder

> `readonly` **selectionOrder**: `"recency"` \| `"relevance"`

Defined in: [src/memory/retrieval/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L140)

How the budget picker ordered the admitted set. See the note on `rank`.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/memory/retrieval/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/memory/retrieval/types.ts#L117)

The quality floor. Absent when the retriever set none.
