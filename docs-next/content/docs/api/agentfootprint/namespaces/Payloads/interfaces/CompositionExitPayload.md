---
title: CompositionExitPayload
---

# Interface: CompositionExitPayload

Defined in: [src/events/payloads.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L31)

## Properties

### durationMs

> `readonly` **durationMs**: `number`

Defined in: [src/events/payloads.ts:42](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L42)

***

### id

> `readonly` **id**: `string`

Defined in: [src/events/payloads.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L33)

***

### kind

> `readonly` **kind**: [`CompositionKind`](/docs/api/type-aliases/CompositionKind)

Defined in: [src/events/payloads.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L32)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/events/payloads.ts:40](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L40)

Display name supplied at composition build time (e.g., the
 `Sequence.create({ name: 'IntakePipeline' })` arg). Mirrors the
 `name` field on `CompositionEnterPayload` so consumers narrating
 the exit moment can reference the same human-readable identity
 used at entry — no name-cache required across the start/stop
 pair. Optional for back-compat with pre-v2.14.5 emitters.

***

### status

> `readonly` **status**: `"ok"` \| `"err"` \| `"break"` \| `"budget_exhausted"`

Defined in: [src/events/payloads.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L41)
