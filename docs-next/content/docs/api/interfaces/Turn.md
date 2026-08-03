---
title: Turn
---

# Interface: Turn

Defined in: src/core/agent/window/turns.ts:32

One turn: a `user` / `assistant` / `system` message plus every `tool`
message that answers it. Tool results belong to the assistant turn that
requested them — that pairing is the thing a removal must never break.

## Properties

### index

> `readonly` **index**: `number`

Defined in: src/core/agent/window/turns.ts:34

Index of this turn in the segmentation.

***

### length

> `readonly` **length**: `number`

Defined in: src/core/agent/window/turns.ts:38

Number of messages in the turn.

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: src/core/agent/window/turns.ts:39

***

### start

> `readonly` **start**: `number`

Defined in: src/core/agent/window/turns.ts:36

Index of the turn's FIRST message in the window.
