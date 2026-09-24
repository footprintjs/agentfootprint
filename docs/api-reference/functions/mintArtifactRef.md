[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mintArtifactRef

# Function: mintArtifactRef()

> **mintArtifactRef**(): `string`

Defined in: [src/artifacts/naming.ts:38](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/naming.ts#L38)

Mint a fresh, opaque, never-content-derived ref.

Rejection sampling keeps the distribution uniform (256 % 62 ≠ 0, so a bare
modulo would bias the low end of the alphabet — cosmetically fine,
cryptographically sloppy, and cheap to do right).

## Returns

`string`
