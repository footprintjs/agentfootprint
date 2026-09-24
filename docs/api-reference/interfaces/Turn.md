[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Turn

# Interface: Turn

Defined in: [src/core/agent/window/turns.ts:34](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L34)

One turn: a `user` / `assistant` / `system` message plus every `tool`
message that answers it. Tool results belong to the assistant turn that
requested them — that pairing is the thing a removal must never break.

## Properties

### index

> `readonly` **index**: `number`

Defined in: [src/core/agent/window/turns.ts:36](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L36)

Index of this turn in the segmentation.

***

### length

> `readonly` **length**: `number`

Defined in: [src/core/agent/window/turns.ts:40](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L40)

Number of messages in the turn.

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/turns.ts:41](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L41)

***

### start

> `readonly` **start**: `number`

Defined in: [src/core/agent/window/turns.ts:38](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L38)

Index of the turn's FIRST message in the window.
