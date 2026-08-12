[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConsentGate

# Interface: ConsentGate

Defined in: [src/core/pause.ts:131](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/pause.ts#L131)

What [pauseDemandsDecision](/agentfootprint/api/generated/functions/pauseDemandsDecision.md) reports about a pause that is a consent gate.

## Properties

### kind

> `readonly` **kind**: [`ConsentGateKind`](/agentfootprint/api/generated/type-aliases/ConsentGateKind.md)

Defined in: [src/core/pause.ts:132](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/pause.ts#L132)

***

### middleware?

> `readonly` `optional` **middleware?**: `string`

Defined in: [src/core/pause.ts:136](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/pause.ts#L136)

`'ask'` only — the `name` of the middleware that asked.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/pause.ts:134](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/pause.ts#L134)

The tool the gate is about, when the pause payload named one.
