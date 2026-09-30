---
title: KeyedFold
---

# Interface: KeyedFold

Defined in: src/lib/time-travel/keyedFold.ts:115

One key's value at one commit — the question, and the answers already
computed for it.

## Properties

### basis

> `readonly` **basis**: [`FoldBasis`](/docs/api/type-aliases/FoldBasis)

Defined in: src/lib/time-travel/keyedFold.ts:117

How this fold was derived — see [FoldBasis](/docs/api/type-aliases/FoldBasis).

***

### length

> `readonly` **length**: `number`

Defined in: src/lib/time-travel/keyedFold.ts:119

How many bundles the log holds.

## Methods

### valueAt()

> **valueAt**(`key`, `idx`): `unknown`

Defined in: src/lib/time-travel/keyedFold.ts:131

The value of `key` folded through commit ARRAY INDEX `idx`, inclusive.
`-1` (or lower) folds nothing and returns the base's value — the state
before the log's first commit.

DEEP-FROZEN, and the same object on every call for the same question. It
is detached from the engine's own bundles AND unmutable, so a caller
cannot rewrite what a later index folds to — `keyedFold.ts` · `freezeDeep`
says why that is a law here rather than a courtesy. Copy it
(`structuredClone`, a spread) if you need something to edit.

#### Parameters

##### key

`string`

##### idx

`number`

#### Returns

`unknown`
