---
title: keywordScorer
---

# Function: keywordScorer()

> **keywordScorer**(`options?`): [`EntryScorer`](/docs/api/interfaces/EntryScorer)

Defined in: src/lib/injection-engine/entryScorer.ts:100

keywordScorer — rank by word overlap between the message and each description.
No embedder, no model call, deterministic. Scores the set-cosine of lowercased
word tokens (length-normalized so a long description can't win on sheer size),
minus a small stop-word list. The zero-config router: good enough when skill
descriptions use the words a user would.

## Parameters

### options?

#### stopWords?

readonly `string`[]

## Returns

[`EntryScorer`](/docs/api/interfaces/EntryScorer)
