---
title: WindowRefusal
---

# Interface: WindowRefusal

Defined in: [src/core/agent/window/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L150)

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L155)

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/docs/api/type-aliases/WindowRefusalReason)

Defined in: [src/core/agent/window/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L151)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L153)

Index of the turn in this iteration's turn segmentation.
