[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RemovalPlan

# Interface: RemovalPlan

Defined in: [src/core/agent/window/turns.ts:126](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core/agent/window/turns.ts#L126)

The span a removal will take, plus every refusal it had to name to get there.

## Properties

### from

> `readonly` **from**: `number`

Defined in: [src/core/agent/window/turns.ts:128](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core/agent/window/turns.ts#L128)

First turn index in the span; -1 when nothing may be removed.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/turns.ts:131](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core/agent/window/turns.ts#L131)

***

### to

> `readonly` **to**: `number`

Defined in: [src/core/agent/window/turns.ts:130](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core/agent/window/turns.ts#L130)

Last turn index in the span (inclusive); -1 when nothing may be removed.
