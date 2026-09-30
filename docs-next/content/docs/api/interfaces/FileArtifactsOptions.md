---
title: FileArtifactsOptions
---

# Interface: FileArtifactsOptions

Defined in: src/artifacts/fileArtifacts.ts:85

Options for [fileArtifacts](/docs/api/functions/fileArtifacts).

## Properties

### directory

> `readonly` **directory**: `string`

Defined in: src/artifacts/fileArtifacts.ts:87

The root directory. Created if missing, parents included.

***

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: src/artifacts/fileArtifacts.ts:90

Retention dials — all optional here: disk is a budget the operator
 already owns. TTL is stamped at mint; budgets sweep oldest-first.
