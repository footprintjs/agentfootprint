---
title: embeddingScorer
---

# Function: embeddingScorer()

> **embeddingScorer**(`embedder`): [`EntryScorer`](/docs/api/interfaces/EntryScorer)

Defined in: src/lib/injection-engine/entryScorer.ts:120

embeddingScorer — rank by SEMANTIC similarity. Embeds the message + each
description and cosine-scores them. Needs an `Embedder` (a model call per text);
runs once per turn off the hot loop. `.entryByRelevance(embedder)` is sugar for
`.entryBy(embeddingScorer(embedder))`.

## Parameters

### embedder

[`Embedder`](/docs/api/interfaces/Embedder)

## Returns

[`EntryScorer`](/docs/api/interfaces/EntryScorer)
