---
title: composeNotCovered
---

# Function: composeNotCovered()

> **composeNotCovered**(`coverage`): readonly `string`[]

Defined in: [src/semantics/envelope.ts:200](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/envelope.ts#L200)

Compose the `not_covered` prose lines FROM coverage — the one derivation,
 used by the mint and by the drift check, so the two can never disagree.

## Parameters

### coverage

[`SemanticCoverage`](/docs/api/interfaces/SemanticCoverage)

## Returns

readonly `string`[]
