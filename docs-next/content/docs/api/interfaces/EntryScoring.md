---
title: EntryScoring
---

# Interface: EntryScoring

Defined in: src/lib/injection-engine/entryScorer.ts:36

Result of scoring the entries — the picked entry, the full ranking, and which
 scorer produced it.

## Properties

### chosen

> `readonly` **chosen**: `string` \| `undefined`

Defined in: src/lib/injection-engine/entryScorer.ts:41

Winning entry id (highest `score`), or undefined if no candidate.

***

### ranked

> `readonly` **ranked**: readonly [`EntryScore`](/docs/api/interfaces/EntryScore)[]

Defined in: src/lib/injection-engine/entryScorer.ts:43

Every scored candidate, in declaration order.

***

### scorer

> `readonly` **scorer**: `string`

Defined in: src/lib/injection-engine/entryScorer.ts:39

The scorer's `name` (e.g. `'keyword'`, `'embedding'`) — surfaced so a lens /
 the "Why this skill?" panel can say HOW the entry was chosen.
