[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RemovalPlan

# Interface: RemovalPlan

Defined in: [src/core/agent/window/turns.ts:192](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L192)

The span a removal will take, plus every refusal it had to name to get there.

## Properties

### from

> `readonly` **from**: `number`

Defined in: [src/core/agent/window/turns.ts:194](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L194)

First turn index in the span; -1 when nothing may be removed.

***

### ledgerFacts?

> `readonly` `optional` **ledgerFacts?**: [`WindowObservations`](/agentfootprint/api/generated/interfaces/WindowObservations.md)

Defined in: [src/core/agent/window/turns.ts:209](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L209)

What the ledger-fact pin did on this plan (9.102.0) — the same shape,
with `limit` = `keepLedgerFacts`. Absent when it held nothing, which on
an agent without `.findings()` is always.

***

### observations?

> `readonly` `optional` **observations?**: [`WindowObservations`](/agentfootprint/api/generated/interfaces/WindowObservations.md)

Defined in: [src/core/agent/window/turns.ts:203](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L203)

What the last-tool-result pin did on this plan (9.57.0) — which turns it
held and what the ceiling turned away. Absent when it held nothing, so a
window with no pinnable result plans exactly as it did before.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/turns.ts:197](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L197)

***

### to

> `readonly` **to**: `number`

Defined in: [src/core/agent/window/turns.ts:196](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/turns.ts#L196)

Last turn index in the span (inclusive); -1 when nothing may be removed.
