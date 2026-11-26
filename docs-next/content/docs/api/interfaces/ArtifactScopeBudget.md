---
title: ArtifactScopeBudget
---

# Interface: ArtifactScopeBudget

Defined in: [src/artifacts/types.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L307)

The budget a store enforces in one scope (see [ArtifactStore.scopeBudget](/docs/api/interfaces/ArtifactStore#scopebudget)).

## Properties

### maxBytes?

> `readonly` `optional` **maxBytes?**: `number`

Defined in: [src/artifacts/types.ts:309](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L309)

The most bytes the scope may hold; absent when bytes do not bind.

***

### maxCount?

> `readonly` `optional` **maxCount?**: `number`

Defined in: [src/artifacts/types.ts:311](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L311)

The most artifacts the scope may hold; absent when the count does not bind.
