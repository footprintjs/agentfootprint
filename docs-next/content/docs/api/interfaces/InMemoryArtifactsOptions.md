---
title: InMemoryArtifactsOptions
---

# Interface: InMemoryArtifactsOptions

Defined in: [src/artifacts/inMemoryArtifacts.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L63)

Options for [inMemoryArtifacts](/docs/api/functions/inMemoryArtifacts).

## Properties

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/inMemoryArtifacts.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L68)

Retention dials. Merged OVER the defaults — name a dial to change it;
the byte and row budgets always exist (see the header for why).
