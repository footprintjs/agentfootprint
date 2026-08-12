[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TopKOptions

# Interface: TopKOptions

Defined in: [src/memory/retrieval/topK.ts:24](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/memory/retrieval/topK.ts#L24)

## Properties

### k?

> `readonly` `optional` **k?**: `number`

Defined in: [src/memory/retrieval/topK.ts:30](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/memory/retrieval/topK.ts#L30)

How many chunks may reach the prompt. Default 3 — enough for more
than one perspective, few enough that the middle of a long context
does not swallow the answer.

***

### rejectWindow?

> `readonly` `optional` **rejectWindow?**: `number`

Defined in: [src/memory/retrieval/topK.ts:57](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/memory/retrieval/topK.ts#L57)

How many extra candidates to pull past `k` so that rejected ones can
be reported. Default 10. Raising it costs one larger read and shows
more near-misses; it can never change which candidates are admitted.

***

### threshold?

> `readonly` `optional` **threshold?**: `number` \| `null`

Defined in: [src/memory/retrieval/topK.ts:51](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/memory/retrieval/topK.ts#L51)

Minimum similarity to admit, in the store's score space ([-1, 1]
cosine for every shipped store). Default 0.7.

**The right threshold is a property of the EMBEDDER, not of this
library.** 0.7 is a high bar for some embedders. Sentence-transformer
relatives (`all-MiniLM-L6-v2` and family, which `localEmbedder` uses by
default) often score 0.4–0.6 on genuinely relevant chunks; OpenAI
`text-embedding-3-*` sits comfortably at 0.7. Amazon Titan Text V2
(`bedrockEmbedder`'s default) was measured in a production corpus at
0.55–0.57 for a direct hit, ~0.49 for the right section diluted by its
neighbours, and 0.36–0.42 for noise — **on that embedder the 0.7
default retrieves NOTHING, silently**; ~0.5 separates its signal from
its noise. If retrievals come back empty, read the
`agentfootprint.memory.retrieved` event: it carries the rejected
candidates and their scores, so the right threshold is a number you
can see rather than one you guess.

Pass `null` for no floor — every candidate up to `k` is admitted.
