[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRefusal

# Interface: WindowRefusal

Defined in: [src/core/agent/window/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L83)

One named refusal, positioned so a reader can find the turn.

## Properties

### messageIndex

> `readonly` **messageIndex**: `number`

Defined in: [src/core/agent/window/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L88)

Index of the turn's first message in the pre-removal window.

***

### reason

> `readonly` **reason**: [`WindowRefusalReason`](/agentfootprint/api/generated/type-aliases/WindowRefusalReason.md)

Defined in: [src/core/agent/window/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L84)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/core/agent/window/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L86)

Index of the turn in this iteration's turn segmentation.
