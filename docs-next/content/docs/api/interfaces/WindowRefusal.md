---
title: WindowRefusal
---

# Interface: WindowRefusal

Defined in: [src/core/agent/window/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L74)

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L79)

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/docs/api/type-aliases/WindowRefusalReason)

Defined in: [src/core/agent/window/types.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L75)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L77)

Index of the turn in this iteration's turn segmentation.
