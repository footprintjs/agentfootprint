---
title: ConsentGate
---

# Interface: ConsentGate

Defined in: [src/core/pause.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L140)

What [pauseDemandsDecision](/docs/api/functions/pauseDemandsDecision) reports about a pause that is a consent gate.

## Properties

### kind

> `readonly` **kind**: [`ConsentGateKind`](/docs/api/type-aliases/ConsentGateKind)

Defined in: [src/core/pause.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L141)

***

### middleware?

> `readonly` `optional` **middleware?**: `string`

Defined in: [src/core/pause.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L145)

`'ask'` only — the `name` of the middleware that asked.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/pause.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L143)

The tool the gate is about, when the pause payload named one.
