[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / explainSemantics

# Function: explainSemantics()

> **explainSemantics**(`value`): readonly [`SemanticIssue`](/agentfootprint/api/generated/interfaces/SemanticIssue.md)[] \| `undefined`

Defined in: [src/lib/semantics/envelope.ts:777](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/envelope.ts#L777)

Name what is wrong with a value that CARRIES the marker but was not
recognized. `undefined` for values without the marker (they are data, not
near-misses) and for well-formed envelopes. Diagnosis only — never changes
what any value does.

## Parameters

### value

`unknown`

## Returns

readonly [`SemanticIssue`](/agentfootprint/api/generated/interfaces/SemanticIssue.md)[] \| `undefined`
