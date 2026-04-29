[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SkillRegistry

# Class: SkillRegistry

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:29](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L29)

## Constructors

### Constructor

> **new SkillRegistry**(): `SkillRegistry`

#### Returns

`SkillRegistry`

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:95](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L95)

Number of registered skills.

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:100](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L100)

Drop all registrations.

#### Returns

`void`

***

### get()

> **get**(`id`): [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md) \| `undefined`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:80](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L80)

Look up by id. Returns undefined if not registered.

#### Parameters

##### id

`string`

#### Returns

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md) \| `undefined`

***

### has()

> **has**(`id`): `boolean`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:85](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L85)

True iff a skill with the given id is registered.

#### Parameters

##### id

`string`

#### Returns

`boolean`

***

### list()

> **list**(): readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:90](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L90)

All registered skills. Order matches registration order.

#### Returns

readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

***

### register()

> **register**(`skill`): `this`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:37](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L37)

Register a skill. Throws if `skill.flavor !== 'skill'` or if a
skill with the same id is already registered (use `.replace(...)`
to overwrite intentionally).

#### Parameters

##### skill

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### replace()

> **replace**(`id`, `skill`): `this`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:53](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L53)

Replace an existing skill by id. Throws if id is not registered.

#### Parameters

##### id

`string`

##### skill

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### unregister()

> **unregister**(`id`): `this`

Defined in: [agentfootprint/src/lib/injection-engine/SkillRegistry.ts:74](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/SkillRegistry.ts#L74)

Remove a skill by id. No-op if not registered.

#### Parameters

##### id

`string`

#### Returns

`this`
