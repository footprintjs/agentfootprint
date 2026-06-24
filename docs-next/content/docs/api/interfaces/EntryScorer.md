---
title: EntryScorer
---

# Interface: EntryScorer

Defined in: src/lib/injection-engine/entryScorer.ts:64

A strategy for ranking entry candidates. Pure given its inputs; may be async (an
embedder makes network calls). Runs ONCE per turn off the hot loop, so cost here
never touches the ReAct inner loop.

## Properties

### name

> `readonly` **name**: `string`

Defined in: src/lib/injection-engine/entryScorer.ts:67

Short, stable name — shown in the lens / "Why this skill?" panel + any
 strategy picker.

## Methods

### score()

> **score**(`input`, `signal?`): [`EntryScoring`](/docs/api/interfaces/EntryScoring) \| `Promise`\<[`EntryScoring`](/docs/api/interfaces/EntryScoring)\>

Defined in: src/lib/injection-engine/entryScorer.ts:68

#### Parameters

##### input

[`EntryScorerInput`](/docs/api/interfaces/EntryScorerInput)

##### signal?

`AbortSignal`

#### Returns

[`EntryScoring`](/docs/api/interfaces/EntryScoring) \| `Promise`\<[`EntryScoring`](/docs/api/interfaces/EntryScoring)\>
