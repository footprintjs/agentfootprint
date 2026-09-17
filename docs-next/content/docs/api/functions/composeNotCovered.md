---
title: composeNotCovered
---

# Function: composeNotCovered()

> **composeNotCovered**(`coverage`): readonly `string`[]

Defined in: [src/lib/semantics/envelope.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/semantics/envelope.ts#L114)

Compose the `not_covered` prose lines FROM coverage — the one derivation,
 used by the mint and by the drift check, so the two can never disagree.

## Parameters

### coverage

[`SemanticCoverage`](/docs/api/interfaces/SemanticCoverage)

## Returns

readonly `string`[]
