[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FileArtifactsOptions

# Interface: FileArtifactsOptions

Defined in: [src/artifacts/fileArtifacts.ts:85](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/fileArtifacts.ts#L85)

Options for [fileArtifacts](/agentfootprint/api/generated/functions/fileArtifacts.md).

## Properties

### directory

> `readonly` **directory**: `string`

Defined in: [src/artifacts/fileArtifacts.ts:87](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/fileArtifacts.ts#L87)

The root directory. Created if missing, parents included.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/agentfootprint/api/generated/interfaces/ArtifactRetention.md)

Defined in: [src/artifacts/fileArtifacts.ts:90](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/fileArtifacts.ts#L90)

Retention dials — all optional here: disk is a budget the operator
 already owns. TTL is stamped at mint; budgets sweep oldest-first.
