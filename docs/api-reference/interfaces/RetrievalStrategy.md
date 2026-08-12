[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalStrategy

# Interface: RetrievalStrategy

Defined in: [src/memory/retrieval/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/memory/retrieval/types.ts#L194)

The retrieval seam: given the candidates a store returned, decide
which of them the prompt may have — and say why about each one.

A strategy NEVER talks to the store and never embeds anything. It is
handed a scored, score-descending pool and returns a verdict per
candidate. That narrowness is what makes it composable: a re-ranker or
a diversity selector is the same shape with a different body.

Shipped: [topK](/agentfootprint/api/generated/functions/topK.md). Deliberately NOT shipped in 8.8.0, and named
here so the destination is on record rather than implied — a
cross-encoder `rerank(...)` and a maximal-marginal-relevance `mmr(...)`
are additional adapters behind this same interface. Neither needs an
engine change, a new stage, or a new event; both were left out because
a re-ranker without a shipped re-ranking model is a config with nothing
to configure.

## Properties

### k

> `readonly` **k**: `number`

Defined in: [src/memory/retrieval/types.ts:198](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/memory/retrieval/types.ts#L198)

How many candidates this strategy is willing to admit.

***

### name

> `readonly` **name**: `string`

Defined in: [src/memory/retrieval/types.ts:196](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/memory/retrieval/types.ts#L196)

Stable name — appears in the recording and in refusal messages.

***

### rejectWindow

> `readonly` **rejectWindow**: `number`

Defined in: [src/memory/retrieval/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/memory/retrieval/types.ts#L205)

How many EXTRA candidates to pull past `k` purely so that rejected
ones can be shown. Never affects which candidates are admitted.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/memory/retrieval/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/memory/retrieval/types.ts#L200)

The quality floor, when the strategy has one.

## Methods

### select()

> **select**(`pool`): readonly `RetrievalVerdict`[]

Defined in: [src/memory/retrieval/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/memory/retrieval/types.ts#L210)

Rule on a score-descending pool. Return one verdict per input, in
the same order. Implementations must not reorder.

#### Parameters

##### pool

readonly `ScoredCandidate`[]

#### Returns

readonly `RetrievalVerdict`[]
