---
title: ConsentGate
---

# Interface: ConsentGate

Defined in: [src/core/pause.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L131)

What [pauseDemandsDecision](/docs/api/functions/pauseDemandsDecision) reports about a pause that is a consent gate.

## Properties

### kind

> `readonly` **kind**: [`ConsentGateKind`](/docs/api/type-aliases/ConsentGateKind)

Defined in: [src/core/pause.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L132)

***

### middleware?

> `readonly` `optional` **middleware?**: `string`

Defined in: [src/core/pause.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L136)

`'ask'` only — the `name` of the middleware that asked.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/pause.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L134)

The tool the gate is about, when the pause payload named one.
