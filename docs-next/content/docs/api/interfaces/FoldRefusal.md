---
title: FoldRefusal
---

# Interface: FoldRefusal

Defined in: src/core/agent/compaction/types.ts:109

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: src/core/agent/compaction/types.ts:114

Index of the turn's first message in the pre-fold window.

***

### reason

> `readonly` **reason**: [`FoldRefusalReason`](/docs/api/type-aliases/FoldRefusalReason)

Defined in: src/core/agent/compaction/types.ts:110

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: src/core/agent/compaction/types.ts:112

Index of the turn in this iteration's turn segmentation.
