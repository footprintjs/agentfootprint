---
title: WindowRefusal
---

# Interface: WindowRefusal

Defined in: [src/core/agent/window/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L143)

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L148)

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/docs/api/type-aliases/WindowRefusalReason)

Defined in: [src/core/agent/window/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L144)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L146)

Index of the turn in this iteration's turn segmentation.
