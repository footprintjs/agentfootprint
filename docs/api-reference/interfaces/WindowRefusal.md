[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRefusal

# Interface: WindowRefusal

Defined in: [src/core/agent/window/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L92)

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L97)

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/agentfootprint/api/generated/type-aliases/WindowRefusalReason.md)

Defined in: [src/core/agent/window/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L93)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/window/types.ts#L95)

Index of the turn in this iteration's turn segmentation.
