---
title: InMemoryArtifactsOptions
---

# Interface: InMemoryArtifactsOptions

Defined in: [src/artifacts/inMemoryArtifacts.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L64)

Options for [inMemoryArtifacts](/docs/api/functions/inMemoryArtifacts).

## Properties

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/docs/api/interfaces/ArtifactRetention)

Defined in: [src/artifacts/inMemoryArtifacts.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/inMemoryArtifacts.ts#L69)

Retention dials. Merged OVER the defaults — name a dial to change it;
the byte and row budgets always exist (see the header for why).
