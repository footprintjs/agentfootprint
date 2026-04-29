---
name: Top-K strategy — semantic retrieval (relevance, not recency)
group: memory
guide: ../../src/memory/README.md
defaultInput: Tell me about the refund policy you mentioned.
---

# Top-K — semantic retrieval via embeddings

Where Window picks by recency, Top-K picks by **relevance**:
embed the user's question, find the most cosine-similar past entries,
inject those.

The first strategy that requires an `Embedder` and a vector-capable
store. Cost shifts: embedding calls per turn (cheap) instead of
summarizer calls (more expensive but richer).

## When to use

- Users **ask follow-up questions about specific past topics** ("the
  refund policy you mentioned" — that lives 30 turns ago, recency
  alone won't surface it)
- You have a vector backend in production (`pgvector`, Pinecone,
  Qdrant, Weaviate) — `InMemoryStore`'s linear cosine scan is fine
  for dev/tests but not for scale
- Conversations are **long but topic-focused** — recency-based memory
  loads irrelevant noise

## Strict threshold semantics

```ts
strategy: {
  kind: MEMORY_STRATEGIES.TOP_K,
  topK: 3,
  threshold: 0.6,   // ← strict: drop matches below 0.6 cosine
  embedder,
}
```

When **no past entry meets the threshold**, the strategy returns
**empty**. NO fallback that returns top-K anyway. **Garbage past
context is worse than no context** — it primes the LLM toward a
wrong direction.

This was an explicit panel decision (LLM Systems hat) — different
from typical RAG implementations that always return top-K regardless
of score.

## Tuning

| Knob | Effect |
|---|---|
| `topK: 1` | Single-best match — fastest, lowest token cost |
| `topK: 3–5` | Multiple perspectives — better recall, more tokens |
| `threshold: 0.5` | Permissive — surface even weak matches |
| `threshold: 0.7` | Default — only solid matches |
| `threshold: 0.85+` | Strict — only near-duplicates (legal / compliance) |

## Embedder + store compatibility

`MemoryEntry.embeddingModel` records which embedder produced each
vector. When you swap embedders later, the store filters out
incompatible vectors at query time — preventing silent cross-model
similarity pollution.

Always pass the same embedder instance (or one with the same `name`)
across all turns of a conversation:

```ts
import { openaiEmbedder } from '@some-embedder-pkg';
const embedder = openaiEmbedder({
  model: 'text-embedding-3-small',
  apiKey: process.env.OPENAI_API_KEY,
});
```

## Why it's `MEMORY_TYPES.SEMANTIC` not `EPISODIC`

`SEMANTIC` is the type pairing for "extracted/structured information
to recall." Top-K on raw episodic messages also works (use type
EPISODIC) but the conventional pairing is SEMANTIC for fact-shaped
data. See [Extract](./05-extract-strategy.md) for the LLM-extraction
companion.

## Related

- **[Extract](./05-extract-strategy.md)** — LLM extracts structured facts on write, then Top-K loads them
- **[Causal](./06-causal-snapshot.md)** — Top-K applied to footprintjs snapshots, the differentiator
- **[Window](./01-window-strategy.md)** — when relevance doesn't matter, recency does
