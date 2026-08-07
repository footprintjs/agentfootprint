[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Turn

# Interface: Turn

Defined in: [src/core/agent/window/turns.ts:32](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/turns.ts#L32)

One turn: a `user` / `assistant` / `system` message plus every `tool`
message that answers it. Tool results belong to the assistant turn that
requested them — that pairing is the thing a removal must never break.

## Properties

### index

> `readonly` **index**: `number`

Defined in: [src/core/agent/window/turns.ts:34](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/turns.ts#L34)

Index of this turn in the segmentation.

***

### length

> `readonly` **length**: `number`

Defined in: [src/core/agent/window/turns.ts:38](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/turns.ts#L38)

Number of messages in the turn.

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/turns.ts:39](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/turns.ts#L39)

***

### start

> `readonly` **start**: `number`

Defined in: [src/core/agent/window/turns.ts:36](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/turns.ts#L36)

Index of the turn's FIRST message in the window.
