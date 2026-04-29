[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineFactOptions

# Interface: DefineFactOptions

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L32)

## Properties

### activeWhen?

> `readonly` `optional` **activeWhen?**: (`ctx`) => `boolean`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:51](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L51)

Trigger control. Defaults to always-on. For conditional facts
(e.g., "only show user profile after iteration 3"), pass a
predicate via `activeWhen`.

#### Parameters

##### ctx

[`InjectionContext`](/agentfootprint/api/generated/interfaces/InjectionContext.md)

#### Returns

`boolean`

***

### data

> `readonly` **data**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L36)

The fact (data string) to inject.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L34)

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:33](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L33)

***

### role?

> `readonly` `optional` **role?**: [`ContextRole`](/agentfootprint/api/generated/type-aliases/ContextRole.md)

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:45](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L45)

When `slot: 'messages'`, the role to use. Default `'system'`.

***

### slot?

> `readonly` `optional` **slot?**: `"system-prompt"` \| `"messages"`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineFact.ts:43](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineFact.ts#L43)

Which slot to land in. Default `'system-prompt'` (most common —
facts the model should always have in mind).
`'messages'` for facts that should appear inline with the
conversation history (use sparingly — increases token cost).
