---
name: RAG — retrieve, augment, generate
group: concepts
guide: ../../docs/guides/concepts.md#rag
defaultInput: What is the ultimate answer?
---

# RAG — retrieve, augment, generate

Look things up before generating. The retriever fetches relevant chunks from a knowledge base; those chunks are injected into the prompt; *then* the LLM answers — grounded in the retrieved evidence.

**Background:** *Retrieval-Augmented Generation* (Lewis et al. 2020, NeurIPS) — the canonical answer to "the LLM doesn't know my domain documents."

## When to use

- Q&A over your own documents (manuals, policies, knowledge bases).
- When you need answers to be **grounded** — `result.chunks` shows which sources informed the answer.
- When the corpus is too big to fit in the prompt.

## What you'll see in the trace

```
Entered SeedScope.
Entered Retrieve. → 2 chunks (top score: 0.95)
Entered AugmentPrompt.
Entered CallLLM.
Entered ParseResponse.
Entered Finalize.
```

`result.chunks` carries the retrieved passages with scores — auditable grounding.

## Key API

- `RAG.create({ provider, retriever })` — needs both.
- `.topK(n)` — how many chunks to retrieve.
- `.minScore(s)` — drop chunks below this similarity threshold (silent zero-chunk risk if too high).

## Failure modes

- Retriever returns zero chunks → LLM gets an empty context block and may answer from training data (not grounded). Inspect `result.chunks.length` for callers that require grounding.
- `minScore` too high → silent zero-chunk problem.

## Related concepts

- **[LLMCall](./01-llm-call.md)** — the rung below; no retrieval.
- **[integrations/01-full-integration](../integrations/01-full-integration.md)** — RAG composed with Agent + tools.
