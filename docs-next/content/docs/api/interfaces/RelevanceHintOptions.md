---
title: RelevanceHintOptions
---

# Interface: RelevanceHintOptions

Defined in: [src/lib/injection-engine/factories/defineRelevanceHint.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineRelevanceHint.ts#L19)

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/lib/injection-engine/factories/defineRelevanceHint.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineRelevanceHint.ts#L21)

Injection id (default `'relevance-hint'`).

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/lib/injection-engine/factories/defineRelevanceHint.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineRelevanceHint.ts#L26)

Near-tie threshold: the hint fires when (top relevance − 2nd relevance) is
below this. Default `0.15` (relevances are softmax shares summing to 1).
