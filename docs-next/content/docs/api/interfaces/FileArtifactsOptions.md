---
title: FileArtifactsOptions
---

# Interface: FileArtifactsOptions

Defined in: [src/artifacts/fileArtifacts.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L86)

Options for [fileArtifacts](/docs/api/functions/fileArtifacts).

## Properties

### directory

> `readonly` **directory**: `string`

Defined in: [src/artifacts/fileArtifacts.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L88)

The root directory. Created if missing, parents included.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/fileArtifacts.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/fileArtifacts.ts#L91)

Retention dials — all optional here: disk is a budget the operator
 already owns. TTL is stamped at mint; budgets sweep oldest-first.
