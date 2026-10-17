---
title: ClaimRequirementAssessment
---

# Interface: ClaimRequirementAssessment

Defined in: [src/answer-validation/requirements.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L21)

The check concerns prerequisites only; it does not establish a factual value's truth.

## Properties

### check

> `readonly` **check**: [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)

Defined in: [src/answer-validation/requirements.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L22)

***

### requirementResultRefs

> `readonly` **requirementResultRefs**: readonly `string`[]

Defined in: [src/answer-validation/requirements.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L24)

Matched RequirementResult.id selectors, NOT artifact refs or AnswerCheck.evidenceRefs.
