---
name: Extract strategy — LLM distills facts/beats on write
group: memory
guide: ../../src/memory/README.md
defaultInput: What do you know about me?
---

# Extract — distill structured data on write

Smart-write counterpart to Top-K's smart-read. At **write time**, an
extractor pulls structured shapes (facts, narrative beats) out of the
conversation. The read side later loads those structured shapes —
compact, dedupable, and far more reliable than re-scanning raw messages.

## Two extractor variants

```ts
strategy: {
  kind: MEMORY_STRATEGIES.EXTRACT,
  extractor: 'pattern',           // regex heuristics, zero LLM cost
}
// or
strategy: {
  kind: MEMORY_STRATEGIES.EXTRACT,
  extractor: 'llm',
  llm: anthropic('claude-haiku-4-5'),   // paid, richer extraction
  minConfidence: 0.7,                   // drop weak guesses
  maxPerTurn: 5,                        // cap fact explosion
}
```

## What gets extracted

A `Fact` has `subject / predicate / object / confidence`:

```
{ subject: 'user', predicate: 'name', object: 'Alice',         confidence: 0.95 }
{ subject: 'user', predicate: 'employer', object: 'Acme',      confidence: 0.85 }
{ subject: 'user', predicate: 'plan', object: 'Pro',           confidence: 0.92 }
```

A `NarrativeBeat` is one event in the conversation arc:

```
{ when: 'turn 3', what: 'user upgraded plan', importance: 'high' }
```

## When to use

- **User-facing assistants** that build a profile over time (preferences,
  identity, plan tier, last action)
- **Audit / compliance** flows where you need a queryable fact log
- **RAG pre-processing** — facts dedupe across turns; raw messages don't
- **Long-running agents** where raw history would explode the store

## Trade-offs

| | Pattern extractor | LLM extractor |
|---|---|---|
| Cost | Free | $0.001–0.01 per turn (haiku-class) |
| Latency | Sub-ms | 100–500ms |
| Recall | Limited (regex coverage) | High (semantic understanding) |
| Hallucination risk | Zero (only matches present text) | Some (LLM can fabricate facts) |
| Best for | Structured user input ("My email is X") | Natural dialogue |

## Combining with retrieval

`Extract` is typically paired with `Top-K` on the SAME store: extract
on write, retrieve on read. The single `defineMemory({ kind: HYBRID })`
call (see [Hybrid](./07-hybrid-auto.md)) wires both sides up.

## Privacy

Extracted facts persist longer than raw messages — they're the durable
shape. Apply `redact: { patterns: [...] }` on `defineMemory()` to mask
PII before extraction (API hook reserved; impl in a future release).

## Related

- **[Top-K](./04-topK-strategy.md)** — the read-side counterpart
- **[Hybrid](./07-hybrid-auto.md)** — Extract + Top-K + others composed
- **[Causal](./06-causal-snapshot.md)** — extracts decision evidence, not facts
