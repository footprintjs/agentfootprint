---
title: RemovalFacts
---

# Interface: RemovalFacts

Defined in: src/core/agent/window/strategy.ts:54

The provenance of a set of removed messages, as the ledger needs it.

## Properties

### evictions

> `readonly` **evictions**: readonly [`WindowEviction`](/docs/api/interfaces/WindowEviction)[]

Defined in: src/core/agent/window/strategy.ts:58

One eviction per message, with its measured lifetime.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: src/core/agent/window/strategy.ts:56

`runtimeStageId`s of the stages that appended those messages, in order.
