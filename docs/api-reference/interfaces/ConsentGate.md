[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConsentGate

# Interface: ConsentGate

Defined in: [src/core/pause.ts:131](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L131)

What [pauseDemandsDecision](/agentfootprint/api/generated/functions/pauseDemandsDecision.md) reports about a pause that is a consent gate.

## Properties

### kind

> `readonly` **kind**: [`ConsentGateKind`](/agentfootprint/api/generated/type-aliases/ConsentGateKind.md)

Defined in: [src/core/pause.ts:132](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L132)

***

### middleware?

> `readonly` `optional` **middleware?**: `string`

Defined in: [src/core/pause.ts:136](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L136)

`'ask'` only — the `name` of the middleware that asked.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/pause.ts:134](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/pause.ts#L134)

The tool the gate is about, when the pause payload named one.
