[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / readSemantics

# Function: readSemantics()

> **readSemantics**(`value`): [`ToolSemantics`](/agentfootprint/api/generated/interfaces/ToolSemantics.md) \| `undefined`

Defined in: [src/lib/semantics/envelope.ts:765](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/envelope.ts#L765)

Recognize (or decline to recognize) a value as a semantic envelope —
STRICT, and the strictness is the zero-cost guarantee. Only a plain object
whose `af_semantics` is exactly `true` AND that passes the whole rule set
qualifies; every other value any tool has ever returned takes the path it
always took, byte for byte.

`undefined` means "not an envelope this library can honor" — a marker-
bearing value with faults stays DATA (never half-applied); the dispatch
loop dev-warns it and `check:semantics` names every fault.

## Parameters

### value

`unknown`

## Returns

[`ToolSemantics`](/agentfootprint/api/generated/interfaces/ToolSemantics.md) \| `undefined`
