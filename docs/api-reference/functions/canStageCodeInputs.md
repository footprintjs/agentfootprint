[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / canStageCodeInputs

# Function: canStageCodeInputs()

> **canStageCodeInputs**(`session`): `session is CodeSession & Required<Pick<CodeSession, "stageInputs">>`

Defined in: [src/adapters/types.ts:1152](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/types.ts#L1152)

Can this session accept staged inputs? The feature-detection law: read the
 member, never assume it from the adapter's name.

## Parameters

### session

[`CodeSession`](/agentfootprint/api/generated/interfaces/CodeSession.md)

## Returns

`session is CodeSession & Required<Pick<CodeSession, "stageInputs">>`
