[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConsentGate

# Interface: ConsentGate

Defined in: [src/core/pause.ts:140](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/pause.ts#L140)

What [pauseDemandsDecision](/agentfootprint/api/generated/functions/pauseDemandsDecision.md) reports about a pause that is a consent gate.

## Properties

### kind

> `readonly` **kind**: [`ConsentGateKind`](/agentfootprint/api/generated/type-aliases/ConsentGateKind.md)

Defined in: [src/core/pause.ts:141](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/pause.ts#L141)

***

### middleware?

> `readonly` `optional` **middleware?**: `string`

Defined in: [src/core/pause.ts:145](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/pause.ts#L145)

`'ask'` only — the `name` of the middleware that asked.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/pause.ts:143](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/pause.ts#L143)

The tool the gate is about, when the pause payload named one.
