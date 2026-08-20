---
title: Turn
---

# Interface: Turn

Defined in: [src/core/agent/window/turns.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/turns.ts#L33)

One turn: a `user` / `assistant` / `system` message plus every `tool`
message that answers it. Tool results belong to the assistant turn that
requested them — that pairing is the thing a removal must never break.

## Properties

### index

> `readonly` **index**: `number`

Defined in: [src/core/agent/window/turns.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/turns.ts#L35)

Index of this turn in the segmentation.

***

### length

> `readonly` **length**: `number`

Defined in: [src/core/agent/window/turns.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/turns.ts#L39)

Number of messages in the turn.

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/window/turns.ts:40](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/turns.ts#L40)

***

### start

> `readonly` **start**: `number`

Defined in: [src/core/agent/window/turns.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/turns.ts#L37)

Index of the turn's FIRST message in the window.
