[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactListOptions

# Interface: ArtifactListOptions

Defined in: [src/artifacts/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L162)

Options for `list` — the cursor convention `MemoryStore.list` set.

## Properties

### cursor?

> `readonly` `optional` **cursor?**: `string`

Defined in: [src/artifacts/types.ts:164](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L164)

Continuation token from a previous page. Omit for the first page.

***

### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: [src/artifacts/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L166)

Maximum rows this page. Adapters may cap it lower.
