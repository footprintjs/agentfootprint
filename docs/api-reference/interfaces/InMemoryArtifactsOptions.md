[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InMemoryArtifactsOptions

# Interface: InMemoryArtifactsOptions

Defined in: [src/artifacts/inMemoryArtifacts.ts:63](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/inMemoryArtifacts.ts#L63)

Options for [inMemoryArtifacts](/agentfootprint/api/generated/functions/inMemoryArtifacts.md).

## Properties

### retention?

> `readonly` `optional` **retention?**: [`ArtifactRetention`](/agentfootprint/api/generated/interfaces/ArtifactRetention.md)

Defined in: [src/artifacts/inMemoryArtifacts.ts:68](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/inMemoryArtifacts.ts#L68)

Retention dials. Merged OVER the defaults — name a dial to change it;
the byte and row budgets always exist (see the header for why).
