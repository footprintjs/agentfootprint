---
title: WindowRefusal
---

# Interface: WindowRefusal

Defined in: src/core/agent/window/types.ts:115

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: src/core/agent/window/types.ts:120

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/docs/api/type-aliases/WindowRefusalReason)

Defined in: src/core/agent/window/types.ts:116

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: src/core/agent/window/types.ts:118

Index of the turn in this iteration's turn segmentation.
