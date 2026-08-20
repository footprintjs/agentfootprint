[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactStoreMember

# Type Alias: ArtifactStoreMember

> **ArtifactStoreMember** = `"putStream"` \| `"getStream"`

Defined in: [src/artifacts/conformance/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/conformance/types.ts#L51)

Members a case cannot run without.

`putStream` and `getStream` are OPTIONAL on the port — a store that cannot
move a payload without holding it whole leaves them ABSENT rather than
faking one — so a store that lacks one is not failing anything, and a case
about it is reported `'not-applicable'` rather than passed or failed. That
is the port's own feature-detection rule, applied to its own battery.
