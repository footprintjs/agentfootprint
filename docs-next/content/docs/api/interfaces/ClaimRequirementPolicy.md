---
title: ClaimRequirementPolicy
---

# Interface: ClaimRequirementPolicy

Defined in: [src/answer-validation/requirements.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L11)

Host-authored obligations for one claim at one exact finding and window.

## Properties

### claimRef

> `readonly` **claimRef**: `string`

Defined in: [src/answer-validation/requirements.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L13)

Also the AnswerCheck id: at most 128 characters, with no whitespace.

***

### findingRef

> `readonly` **findingRef**: `string`

Defined in: [src/answer-validation/requirements.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L14)

***

### requirementRefs

> `readonly` **requirementRefs**: readonly `string`[]

Defined in: [src/answer-validation/requirements.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L17)

Nonempty, distinct expected obligations; at most 16 opaque references.

***

### windowRef

> `readonly` **windowRef**: `string`

Defined in: [src/answer-validation/requirements.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/requirements.ts#L15)
