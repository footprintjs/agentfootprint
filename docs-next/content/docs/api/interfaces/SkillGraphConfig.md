---
title: SkillGraphConfig
---

# Interface: SkillGraphConfig

Defined in: [src/lib/injection-engine/skillGraph.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L63)

Object-literal form of a skill graph — an alternative to the fluent builder.
Listing `skills` INDEPENDENTLY of the wiring is the point: the check-up can then
flag a skill that was listed but never wired (the fluent builder only ever sees
skills that appear in an edge). Compiles to the SAME `SkillGraph`. `check`
defaults to `'throw'` here (a new surface, fail-loud).

## Properties

### check?

> `readonly` `optional` **check?**: [`GraphCheckMode`](/docs/api/type-aliases/GraphCheckMode)

Defined in: [src/lib/injection-engine/skillGraph.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L95)

***

### skills

> `readonly` **skills**: readonly [`Injection`](/docs/api/interfaces/Injection)[]

Defined in: [src/lib/injection-engine/skillGraph.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L65)

Every skill in the graph (wired or not).

***

### start?

> `readonly` `optional` **start?**: `string` \| \{ `use`: `string`; \} \| \{ `rules`: readonly `object`[]; \} \| \{ `byRelevance?`: [`Embedder`](/docs/api/interfaces/Embedder); `entries`: readonly `string`[]; `scoredBy?`: [`EntryScorer`](/docs/api/interfaces/EntryScorer); \}

Defined in: [src/lib/injection-engine/skillGraph.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L67)

Where a turn starts. Omit when using `tree`.

#### Union Members

`string`

***

##### Type Literal

\{ `use`: `string`; \}

***

##### Type Literal

\{ `rules`: readonly `object`[]; \}

***

##### Type Literal

\{ `byRelevance?`: [`Embedder`](/docs/api/interfaces/Embedder); `entries`: readonly `string`[]; `scoredBy?`: [`EntryScorer`](/docs/api/interfaces/EntryScorer); \}

##### byRelevance?

> `readonly` `optional` **byRelevance?**: [`Embedder`](/docs/api/interfaces/Embedder)

Sugar: rank the entries with an embedder (cosine/softmax). Omit both → the
 LLM reads the menu and picks (`.entryByRead()`) — no model call.

##### entries

> `readonly` **entries**: readonly `string`[]

##### scoredBy?

> `readonly` `optional` **scoredBy?**: [`EntryScorer`](/docs/api/interfaces/EntryScorer)

Rank the entries with a scorer strategy (`keywordScorer()`,
 `embeddingScorer(e)`, or your own). Takes precedence over `byRelevance`.

***

### steps?

> `readonly` `optional` **steps?**: readonly `object`[]

Defined in: [src/lib/injection-engine/skillGraph.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L86)

Tool-result transitions; `from`/`to` are skill ids resolved against `skills`.

***

### tree?

> `readonly` `optional` **tree?**: [`Injection`](/docs/api/interfaces/Injection) \| [`DecisionNode`](/docs/api/interfaces/DecisionNode)

Defined in: [src/lib/injection-engine/skillGraph.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L94)

A decision tree (instead of `start` + `steps`).
