[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RemovalPlan

# Interface: RemovalPlan

Defined in: [src/core/agent/window/turns.ts:167](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/turns.ts#L167)

The span a removal will take, plus every refusal it had to name to get there.

## Properties

### from

> `readonly` **from**: `number`

Defined in: [src/core/agent/window/turns.ts:169](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/turns.ts#L169)

First turn index in the span; -1 when nothing may be removed.

***

### observations?

> `readonly` `optional` **observations?**: [`WindowObservations`](/agentfootprint/api/generated/interfaces/WindowObservations.md)

Defined in: [src/core/agent/window/turns.ts:178](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/turns.ts#L178)

What the last-tool-result pin did on this plan (9.57.0) — which turns it
held and what the ceiling turned away. Absent when it held nothing, so a
window with no pinnable result plans exactly as it did before.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/turns.ts:172](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/turns.ts#L172)

***

### to

> `readonly` **to**: `number`

Defined in: [src/core/agent/window/turns.ts:171](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/turns.ts#L171)

Last turn index in the span (inclusive); -1 when nothing may be removed.
