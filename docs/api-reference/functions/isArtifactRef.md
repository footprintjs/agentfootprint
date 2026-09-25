[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isArtifactRef

# Function: isArtifactRef()

> **isArtifactRef**(`candidate`): `candidate is string`

Defined in: [src/artifacts/naming.ts:62](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/naming.ts#L62)

Is this string a well-formed artifact ref?

Structural, total, and the ONLY recognizer. Adapters call it before any
ref touches a filesystem path or a SQL parameter: refs are minted so a
traversal payload cannot arrive by construction — and this asserts it
anyway, because "cannot happen" is a claim, not a defence.

## Parameters

### candidate

`unknown`

## Returns

`candidate is string`
