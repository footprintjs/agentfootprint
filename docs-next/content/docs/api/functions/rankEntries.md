---
title: rankEntries
---

# Function: rankEntries()

> **rankEntries**(`scorerName`, `candidates`, `rawScores`): [`EntryScoring`](/docs/api/interfaces/EntryScoring)

Defined in: src/lib/injection-engine/entryScorer.ts:77

Shared finisher: raw scores → `EntryScoring`. Softmax turns the raw scores into a
`relevance` share (sums to 1); the winner is the argmax raw score with declaration
order breaking ties. Because softmax is monotonic, the surfaced % and the pick
always agree.

## Parameters

### scorerName

`string`

### candidates

readonly [`EntryCandidate`](/docs/api/interfaces/EntryCandidate)[]

### rawScores

readonly `number`[]

## Returns

[`EntryScoring`](/docs/api/interfaces/EntryScoring)
