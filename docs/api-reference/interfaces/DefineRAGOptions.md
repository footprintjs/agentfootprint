[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineRAGOptions

# Interface: DefineRAGOptions

Defined in: [src/lib/rag/defineRAG.ts:139](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L139)

## Properties

### corpus?

> `readonly` `optional` **corpus?**: `MemoryIdentity`

Defined in: [src/lib/rag/defineRAG.ts:205](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L205)

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

Defined in: [src/lib/rag/defineRAG.ts:148](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L148)

Human-readable description. Surfaces in narrative + Lens hover.
Recommend describing the *corpus* (e.g., "Product documentation
chunks indexed weekly from docs.example.com").

***

### embedder?

> `readonly` `optional` **embedder?**: `Embedder`

Defined in: [src/lib/rag/defineRAG.ts:176](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L176)

Embedder used for the read-side query. Pass the SAME embedder
instance (or one with the same `embedderId`) that was used for
indexing — cross-model similarity scores are not comparable.

**Optional since 9.3.0, for one case only.** A store that declares
`ranksBy: 'server-text'` (see MemoryStore.ranksBy) takes the
question as WORDS and ranks it on the backend's side; there is nothing
here for an embedder to do, and embedding the query anyway would be spend
on a vector discarded on arrival. Against such a store this must be
OMITTED — passing one is refused rather than ignored, because an ignored
embedder reads, from the wiring, exactly like a working one.

Against every other store it is still required.

***

### embedderId?

> `readonly` `optional` **embedderId?**: `string`

Defined in: [src/lib/rag/defineRAG.ts:188](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L188)

Stable id of the embedder. Stored on entries during indexing
(via `indexDocuments`) and filtered at search time so a later
embedder swap doesn't pollute results.

Refused alongside a `'server-text'` store for the same reason
[embedder](/agentfootprint/api/generated/interfaces/DefineRAGOptions.md#embedder) is: the backend's records were never written here and
carry no `embeddingModel` to filter on, so the option would name a filter
that filtered nothing.

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/rag/defineRAG.ts:141](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L141)

Stable id. Becomes the scope-key suffix and the Lens label.

***

### maxChars?

> `readonly` `optional` **maxChars?**: `number`

Defined in: [src/lib/rag/defineRAG.ts:277](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L277)

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

Defined in: [src/lib/rag/defineRAG.ts:293](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L293)

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

Defined in: [src/lib/rag/defineRAG.ts:159](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L159)

Store containing the indexed corpus. Must implement `search()`. Use
`indexDocuments(store, embedder, docs)` at startup to populate it. Ships
with `InMemoryStore` for dev/tests; swap to a durable adapter in
production.

A store that declares `ranksBy: 'server-text'` is served by the backend's
own index rather than one built here — see [embedder](/agentfootprint/api/generated/interfaces/DefineRAGOptions.md#embedder).

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/lib/rag/defineRAG.ts:233](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L233)

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

Defined in: [src/lib/rag/defineRAG.ts:214](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/lib/rag/defineRAG.ts#L214)

Top-K chunks to retrieve per turn. Default 3 (balanced —
defends against lost-in-the-middle while giving multiple
perspectives). Increase for richer context, decrease for cost.

Shorthand for `retrieval: topK({ k })`; the two EXCLUDE.
