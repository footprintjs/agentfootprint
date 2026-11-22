---
title: canStageCodeInputs
---

# Function: canStageCodeInputs()

> **canStageCodeInputs**(`session`): `session is CodeSession & Required<Pick<CodeSession, "stageInputs">>`

Defined in: [src/provider-contract/types.ts:1208](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1208)

Can this session accept staged inputs? The feature-detection law: read the
 member, never assume it from the adapter's name.

## Parameters

### session

[`CodeSession`](/docs/api/interfaces/CodeSession)

## Returns

`session is CodeSession & Required<Pick<CodeSession, "stageInputs">>`
