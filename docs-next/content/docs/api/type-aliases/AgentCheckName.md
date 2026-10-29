---
title: AgentCheckName
---

# Type Alias: AgentCheckName

> **AgentCheckName** = `"claims"` \| `"names-and-numbers"` \| `"negative-claims"`

Defined in: [src/answer-validation/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L130)

One of the agent's own answer checks, named for
[AnswerValidationOptions.agentChecks](/docs/api/interfaces/AnswerValidationOptions#agentchecks): `'claims'` is the `.claims()`
contract, `'names-and-numbers'` is the `.namesAndNumbersFromEvidence()` gate.
