---
title: RetrievalEvidence
---

# Interface: RetrievalEvidence

Defined in: [src/memory/retrieval/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L103)

Everything one retrieval knows about itself. Written to the memory
subflow's scope by `loadRelevant`, refined by `pickByBudget` and
`formatDefault`, and lifted to the PARENT scope by the read mount so
it lands in the root commit log where a slice can reach it.

## Properties

### admittedCount

> `readonly` **admittedCount**: `number`

Defined in: [src/memory/retrieval/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L161)

How many reached the prompt.

***

### candidates?

> `readonly` `optional` **candidates?**: readonly [`RetrievedCandidate`](/docs/api/interfaces/RetrievedCandidate)[]

Defined in: [src/memory/retrieval/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L171)

The candidates themselves, best-scoring first.

`undefined` means this store could not tell us — see
[candidatesOmittedReason](/docs/api/interfaces/RetrievalEvidence#candidatesomittedreason). It never means "there were none";
that case is `[]` with `consideredCount: 0`.

***

### candidatesComplete

> `readonly` **candidatesComplete**: `boolean`

Defined in: [src/memory/retrieval/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L180)

Whether [candidates](/docs/api/interfaces/RetrievalEvidence#candidates) is the complete set of candidates that
existed, or only as far as the pool we asked for reached.

`false` does NOT weaken the admitted set — see the proof in
`loadRelevant`. It only means the REJECTED list is a sample: there
may be further below-threshold entries we never saw.

***

### candidatesOmittedReason?

> `readonly` `optional` **candidatesOmittedReason?**: `string`

Defined in: [src/memory/retrieval/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L182)

Present exactly when `candidates` is undefined.

***

### charsUsed?

> `readonly` `optional` **charsUsed?**: `number`

Defined in: [src/memory/retrieval/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L151)

How many characters of PASSAGE the admitted set spends. Present exactly
when [maxChars](/docs/api/interfaces/RetrievalEvidence#maxchars) is, and re-stated by the budget picker so it can
never disagree with [admittedCount](/docs/api/interfaces/RetrievalEvidence#admittedcount).

Passage characters, not prompt bytes: the `<source …>` wrapper and the
block header are added later by the formatter and are not counted here.
The exact bytes are on each candidate's `promptFragment` once the
formatter has run.

***

### consideredCount

> `readonly` **consideredCount**: `number`

Defined in: [src/memory/retrieval/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L159)

How many candidates came back from the store.

***

### corpusEmpty

> `readonly` **corpusEmpty**: `boolean`

Defined in: [src/memory/retrieval/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L189)

The store returned nothing at all for this namespace. Distinct from
"everything scored below threshold" (`consideredCount > 0`), and the
distinction is the whole diagnosis: an empty namespace almost always
means the corpus was indexed somewhere else.

***

### dimensions?

> `readonly` `optional` **dimensions?**: `number`

Defined in: [src/memory/retrieval/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L155)

Length of the query vector. Mixing two lengths in one store is a config bug.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/memory/retrieval/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L153)

The embedder id the query was produced with, when the caller declared one.

***

### k

> `readonly` **k**: `number`

Defined in: [src/memory/retrieval/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L132)

How many chunks the retriever was willing to admit.

***

### maxChars?

> `readonly` `optional` **maxChars?**: `number`

Defined in: [src/memory/retrieval/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L140)

The character budget the admitted passages were spent against (8.19.0).
Absent when the retriever set none — which is the default, and means
`k` was the only bound on how much text reached the prompt.

***

### memoryId?

> `readonly` `optional` **memoryId?**: `string`

Defined in: [src/memory/retrieval/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L105)

The retriever's id (`defineRAG({ id })`). Stamped by the read mount.

***

### namespace?

> `readonly` `optional` **namespace?**: `string`

Defined in: [src/memory/retrieval/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L191)

The namespace that was searched, as a plain string, for the diagnosis above.

***

### queryHash

> `readonly` **queryHash**: `string`

Defined in: [src/memory/retrieval/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L130)

A stable hash of the query text — NOT the text. The query is already
in the recording once (as `userMessage`); copying it into a second
key would widen the exposure surface for no new information, and any
redaction policy the host configured for the first copy would not
know about the second.

***

### rejectedCount

> `readonly` **rejectedCount**: `number`

Defined in: [src/memory/retrieval/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L163)

`consideredCount - admittedCount`.

***

### selectionOrder

> `readonly` **selectionOrder**: `"recency"` \| `"relevance"`

Defined in: [src/memory/retrieval/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L157)

How the budget picker ordered the admitted set. See the note on `rank`.

***

### strategy

> `readonly` **strategy**: `string`

Defined in: [src/memory/retrieval/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L122)

Which RULE ruled — [RetrievalStrategy.name](/docs/api/interfaces/RetrievalStrategy#name), e.g. `'top-k'`.

The seam promises this on its own `name` field ("appears in the
recording"), and until 9.x the recording did not carry it: a reader
could see `k`, `threshold` and a verdict per candidate, and could not
tell whether a shipped `topK` or a consumer's own re-ranker produced
them. Two strategies with the same `k` leave records that are
otherwise identical, so the name is the only thing that distinguishes
them — and it is the first thing you need when the admitted set looks
wrong.

Always present: a retrieval always ran under exactly one strategy, and
the shorthand (`k` / `minScore`) is `topK` spelled differently, not the
absence of a rule.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/memory/retrieval/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/retrieval/types.ts#L134)

The quality floor. Absent when the retriever set none.
