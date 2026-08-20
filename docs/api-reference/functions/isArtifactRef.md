[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isArtifactRef

# Function: isArtifactRef()

> **isArtifactRef**(`candidate`): `candidate is string`

Defined in: [src/artifacts/naming.ts:62](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/naming.ts#L62)

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
