[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineRAGOptions

# Interface: DefineRAGOptions

Defined in: [src/lib/rag/defineRAG.ts:138](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L138)

## Properties

### corpus?

> `readonly` `optional` **corpus?**: `MemoryIdentity`

Defined in: [src/lib/rag/defineRAG.ts:186](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L186)

The namespace this corpus lives in. Default
`{ conversationId: '_global' }` — the same default `indexDocuments`
writes to, so the plain path needs no argument on either side.

A corpus is deliberately NOT scoped to the run's identity: it is
shared by every conversation, and reading it under a per-run
conversation id is the bug this default fixes.

**Multi-tenant:** pass the tenant's identity here AND the same one to
`indexDocuments({ identity })`. A namespace that holds nothing is now
reported (`corpusEmpty` on `agentfootprint.memory.retrieved`, plus a
one-time warning naming the namespace), so a mismatch is loud rather
than an empty answer.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/rag/defineRAG.ts:147](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L147)

Human-readable description. Surfaces in narrative + Lens hover.
Recommend describing the *corpus* (e.g., "Product documentation
chunks indexed weekly from docs.example.com").

***

### embedder

> `readonly` **embedder**: `Embedder`

Defined in: [src/lib/rag/defineRAG.ts:162](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L162)

Embedder used for the read-side query. Pass the SAME embedder
instance (or one with the same `embedderId`) that was used for
indexing — cross-model similarity scores are not comparable.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/lib/rag/defineRAG.ts:169](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L169)

Stable id of the embedder. Stored on entries during indexing
(via `indexDocuments`) and filtered at search time so a later
embedder swap doesn't pollute results.

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/rag/defineRAG.ts:140](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L140)

Stable id. Becomes the scope-key suffix and the Lens label.

***

### maxChars?

> `readonly` `optional` **maxChars?**: `number`

Defined in: [src/lib/rag/defineRAG.ts:258](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L258)

A character budget for the retrieved passages, spent across them in
RANK order (8.19.0). Default: none — `topK` stays the only bound, so
nothing changes for a retriever that does not ask for this.

**A count bound is not a size bound.** `topK` says how many passages
may reach the prompt and nothing about how long they are: ten chunks
cut by `byHeading()` off ordinary documentation measured 11,153
characters in the field, against a `systemPrompt` slot whose default
budget is 4,000 — an overflow produced entirely by defaults on both
sides. Nothing truncates (the slot warns and emits
`agentfootprint.context.budget_pressure`), so the run was honest about
the over-run and had no way to BOUND it. This is that bound.

The two numbers, side by side, because they are the ones that meet:

| knob | default | what it bounds |
|---|---|---|
| `defineRAG({ topK })` | 3 | how MANY passages |
| `defineRAG({ maxChars })` | none | how much TEXT they may be |
| `Agent.create({ contextBudget: { systemPrompt } })` | 4000 chars | the whole slot they land in |

Retrieved passages share that slot with the system prompt, steering,
facts and skill bodies, so a budget of roughly half the slot is a
sane starting point: `maxChars: 2000` with the 4,000-char default.

The spend is RECORDED, never silent: passages past the budget are
refused with `reason: 'over-char-budget'` on
`agentfootprint.memory.retrieved`, and the record carries `maxChars`
and `charsUsed`. Rank order, tail dropped — so a budget smaller than
the best-scoring passage admits nothing and says so per candidate,
rather than quietly injecting half a passage.

NOT the splitters' `maxChars`: `byHeading({ maxChars })` bounds ONE
chunk at index time (default 1000), this bounds the WHOLE retrieved set
at query time. The first is why the arithmetic above lands where it
does — ten chunks off a 1000-char splitter is ten thousand characters
before a single tag is added.

Composes with `retrieval` (unlike `topK`/`threshold`, which exclude
it): the strategy picks the candidates, this bounds their size.

***

### retrieval?

> `readonly` `optional` **retrieval?**: [`RetrievalStrategy`](/agentfootprint/api/generated/interfaces/RetrievalStrategy.md)

Defined in: [src/lib/rag/defineRAG.ts:274](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L274)

The retrieval rule, spelled out. Replaces `topK` + `threshold`
entirely — passing both is refused, because they could disagree
and the recording would then name a `k` the run did not use.

```ts
import { topK } from 'agentfootprint/memory';
defineRAG({ id, store, embedder, retrieval: topK({ k: 5, threshold: 0.55 }) });
```

A cross-encoder re-ranker and a diversity (MMR) selector are the
next two adapters behind this same interface; neither ships in
8.8.0, and the seam exists so that when they do, nothing else moves.

***

### store

> `readonly` **store**: `MemoryStore`

Defined in: [src/lib/rag/defineRAG.ts:155](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L155)

Vector-capable store containing the indexed corpus. Must implement
`search()`. Use `indexDocuments(store, embedder, docs)` at startup
to populate it. Ships with `InMemoryStore` for dev/tests; swap to
a durable adapter in production.

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/lib/rag/defineRAG.ts:214](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L214)

Minimum cosine similarity to inject. **Strict** — when no chunk
meets the threshold, NO injection happens (no fallback that would
pollute the prompt with weak matches). Default 0.7.

Tuning note: the right threshold is a property of the EMBEDDER. 0.7
is a high bar for some of them. Sentence-BERT relatives
(`all-MiniLM-L6-v2`, etc.) often score 0.4–0.6 even on relevant
chunks; Amazon Titan Text V2 was field-measured at 0.55–0.57 for a
direct hit, ~0.49 for the right section diluted, 0.36–0.42 for
noise — on that embedder the 0.7 default retrieves NOTHING,
silently. You no longer have to guess: the rejected candidates and
their scores are on every `agentfootprint.memory.retrieved` event,
so the right threshold is a number you can read off a run.

Shorthand for `retrieval: topK({ threshold })`; the two EXCLUDE.

***

### topK?

> `readonly` `optional` **topK?**: `number`

Defined in: [src/lib/rag/defineRAG.ts:195](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/lib/rag/defineRAG.ts#L195)

Top-K chunks to retrieve per turn. Default 3 (balanced —
defends against lost-in-the-middle while giving multiple
perspectives). Increase for richer context, decrease for cost.

Shorthand for `retrieval: topK({ k })`; the two EXCLUDE.
