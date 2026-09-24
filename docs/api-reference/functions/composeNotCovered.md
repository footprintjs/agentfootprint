[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / composeNotCovered

# Function: composeNotCovered()

> **composeNotCovered**(`coverage`): readonly `string`[]

Defined in: [src/lib/semantics/envelope.ts:114](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/semantics/envelope.ts#L114)

Compose the `not_covered` prose lines FROM coverage — the one derivation,
 used by the mint and by the drift check, so the two can never disagree.

## Parameters

### coverage

[`SemanticCoverage`](/agentfootprint/api/generated/interfaces/SemanticCoverage.md)

## Returns

readonly `string`[]
