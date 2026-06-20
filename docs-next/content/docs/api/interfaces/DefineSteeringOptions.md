---
title: DefineSteeringOptions
---

# Interface: DefineSteeringOptions

Defined in: [src/lib/injection-engine/factories/defineSteering.ts:25](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/factories/defineSteering.ts#L25)

## Properties

### cache?

> `readonly` `optional` **cache?**: `CachePolicy`

Defined in: [src/lib/injection-engine/factories/defineSteering.ts:40](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/factories/defineSteering.ts#L40)

Cache policy for this steering injection. Defaults to `'always'`
— steering is by definition always-on stable content, ideal for
provider-side caching. Override with `'never'` if the prompt
contains volatile content (timestamps, per-request IDs).

See `CachePolicy` in `agentfootprint/src/cache/types.ts` for all
variants. The CacheDecision subflow reads this from
`injection.metadata.cache` each iteration.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/injection-engine/factories/defineSteering.ts:27](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/factories/defineSteering.ts#L27)

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/factories/defineSteering.ts:26](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/factories/defineSteering.ts#L26)

***

### prompt

> `readonly` **prompt**: `string`

Defined in: [src/lib/injection-engine/factories/defineSteering.ts:29](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/factories/defineSteering.ts#L29)

Always-on text appended to the system-prompt slot.
