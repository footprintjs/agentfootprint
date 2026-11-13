---
title: AgentCheckName
---

# Type Alias: AgentCheckName

> **AgentCheckName** = `"claims"` \| `"names-and-numbers"` \| `"negative-claims"`

Defined in: [src/answer-validation/types.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L131)

One of the agent's own answer checks, named for
[AnswerValidationOptions.agentChecks](/docs/api/interfaces/AnswerValidationOptions#agentchecks): `'claims'` is the `.claims()`
contract, `'names-and-numbers'` is the `.namesAndNumbersFromEvidence()` gate,
`'negative-claims'` is the typed `.negativeClaims({ field, tools })` check.
