---
title: EntryScore
---

# Interface: EntryScore

Defined in: src/lib/injection-engine/entryScorer.ts:24

One entry candidate's relevance to the user's message.

## Properties

### id

> `readonly` **id**: `string`

Defined in: src/lib/injection-engine/entryScorer.ts:26

The entry skill id.

***

### relevance

> `readonly` **relevance**: `number`

Defined in: src/lib/injection-engine/entryScorer.ts:31

Softmax share across candidates, 0..1 — the surfaced "Why this skill?" %.

***

### score

> `readonly` **score**: `number`

Defined in: src/lib/injection-engine/entryScorer.ts:29

Raw, strategy-specific score — cosine for `embedding`, word-overlap for
 `keyword`. Higher = more relevant. Not normalized across strategies.
