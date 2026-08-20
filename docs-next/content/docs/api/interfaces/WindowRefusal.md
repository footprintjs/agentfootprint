---
title: WindowRefusal
---

# Interface: WindowRefusal

Defined in: [src/core/agent/window/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L115)

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L120)

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/docs/api/type-aliases/WindowRefusalReason)

Defined in: [src/core/agent/window/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L116)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L118)

Index of the turn in this iteration's turn segmentation.
