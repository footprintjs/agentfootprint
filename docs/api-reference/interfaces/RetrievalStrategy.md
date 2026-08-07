[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalStrategy

# Interface: RetrievalStrategy

Defined in: [src/memory/retrieval/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/memory/retrieval/types.ts#L166)

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

Defined in: [src/memory/retrieval/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/memory/retrieval/types.ts#L170)

How many candidates this strategy is willing to admit.

***

### name

> `readonly` **name**: `string`

Defined in: [src/memory/retrieval/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/memory/retrieval/types.ts#L168)

Stable name — appears in the recording and in refusal messages.

***

### rejectWindow

> `readonly` **rejectWindow**: `number`

Defined in: [src/memory/retrieval/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/memory/retrieval/types.ts#L177)

How many EXTRA candidates to pull past `k` purely so that rejected
ones can be shown. Never affects which candidates are admitted.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/memory/retrieval/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/memory/retrieval/types.ts#L172)

The quality floor, when the strategy has one.

## Methods

### select()

> **select**(`pool`): readonly `RetrievalVerdict`[]

Defined in: [src/memory/retrieval/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/memory/retrieval/types.ts#L182)

Rule on a score-descending pool. Return one verdict per input, in
the same order. Implementations must not reorder.

#### Parameters

##### pool

readonly `ScoredCandidate`[]

#### Returns

readonly `RetrievalVerdict`[]
