---
title: ConsentGate
---

# Interface: ConsentGate

Defined in: [src/core/pause.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L168)

What [pauseDemandsDecision](/docs/api/functions/pauseDemandsDecision) reports about a pause that is a consent gate.

## Properties

### kind

> `readonly` **kind**: [`ConsentGateKind`](/docs/api/type-aliases/ConsentGateKind)

Defined in: [src/core/pause.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L169)

***

### middleware?

> `readonly` `optional` **middleware?**: `string`

Defined in: [src/core/pause.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L173)

`'ask'` only — the `name` of the middleware that asked.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/pause.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L171)

The tool the gate is about, when the pause payload named one.
