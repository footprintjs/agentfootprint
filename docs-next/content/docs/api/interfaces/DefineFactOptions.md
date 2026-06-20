---
title: DefineFactOptions
---

# Interface: DefineFactOptions

Defined in: [src/lib/injection-engine/factories/defineFact.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L34)

## Properties

### activeWhen?

> `readonly` `optional` **activeWhen?**: (`ctx`) => `boolean`

Defined in: [src/lib/injection-engine/factories/defineFact.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L53)

Trigger control. Defaults to always-on. For conditional facts
(e.g., "only show user profile after iteration 3"), pass a
predicate via `activeWhen`.

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`boolean`

***

### cache?

> `readonly` `optional` **cache?**: `CachePolicy`

Defined in: [src/lib/injection-engine/factories/defineFact.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L61)

Cache policy for this fact injection. Defaults to `'always'` —
facts are typically static data the LLM should always have in mind.
Override with `'never'` for facts containing volatile content
(e.g., a `Current time:` fact); use `{ until }` for time-bounded
facts.

***

### data

> `readonly` **data**: `string`

Defined in: [src/lib/injection-engine/factories/defineFact.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L38)

The fact (data string) to inject.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/injection-engine/factories/defineFact.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L36)

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/factories/defineFact.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L35)

***

### role?

> `readonly` `optional` **role?**: [`ContextRole`](/docs/api/type-aliases/ContextRole)

Defined in: [src/lib/injection-engine/factories/defineFact.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L47)

When `slot: 'messages'`, the role to use. Default `'system'`.

***

### slot?

> `readonly` `optional` **slot?**: `"system-prompt"` \| `"messages"`

Defined in: [src/lib/injection-engine/factories/defineFact.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineFact.ts#L45)

Which slot to land in. Default `'system-prompt'` (most common —
facts the model should always have in mind).
`'messages'` for facts that should appear inline with the
conversation history (use sparingly — increases token cost).
