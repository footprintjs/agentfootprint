[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / composeNotCovered

# Function: composeNotCovered()

> **composeNotCovered**(`coverage`): readonly `string`[]

Defined in: [src/lib/semantics/envelope.ts:114](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/envelope.ts#L114)

Compose the `not_covered` prose lines FROM coverage — the one derivation,
 used by the mint and by the drift check, so the two can never disagree.

## Parameters

### coverage

[`SemanticCoverage`](/agentfootprint/api/generated/interfaces/SemanticCoverage.md)

## Returns

readonly `string`[]
