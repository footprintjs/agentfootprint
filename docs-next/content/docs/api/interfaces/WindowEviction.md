---
title: WindowEviction
---

# Interface: WindowEviction

Defined in: src/core/agent/window/strategy.ts:49

One message leaving the window, with the facts an eviction event needs.

## Properties

### index

> `readonly` **index**: `number`

Defined in: src/core/agent/window/strategy.ts:51

Index in the PRE-change window — the index the content hash was built on.

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: src/core/agent/window/strategy.ts:53

How long it lived in the window. Exact; 0 when its birth is unknown.
