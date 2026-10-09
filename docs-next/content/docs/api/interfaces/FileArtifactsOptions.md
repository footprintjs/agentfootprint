---
title: FileArtifactsOptions
---

# Interface: FileArtifactsOptions

Defined in: [src/artifacts/fileArtifacts.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L85)

Options for [fileArtifacts](/docs/api/functions/fileArtifacts).

## Properties

### directory

> `readonly` **directory**: `string`

Defined in: [src/artifacts/fileArtifacts.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L87)

The root directory. Created if missing, parents included.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/fileArtifacts.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L90)

Retention dials — all optional here: disk is a budget the operator
 already owns. TTL is stamped at mint; budgets sweep oldest-first.
