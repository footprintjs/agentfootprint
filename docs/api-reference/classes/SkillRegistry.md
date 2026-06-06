[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SkillRegistry

# Class: SkillRegistry

Defined in: [src/lib/injection-engine/SkillRegistry.ts:63](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L63)

## Constructors

### Constructor

> **new SkillRegistry**(`opts?`): `SkillRegistry`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:72](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L72)

Construct an empty registry. Optional `{ surfaceMode, providerHint }`
fields set registry-level defaults; absent both, the registry is a
pure container (the v2.4 surface).

#### Parameters

##### opts?

[`SkillRegistryOptions`](/agentfootprint/api/generated/interfaces/SkillRegistryOptions.md) = `{}`

#### Returns

`SkillRegistry`

## Accessors

### providerHint

#### Get Signature

> **get** **providerHint**(): `string` \| `undefined`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:82](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L82)

Registry-level provider hint, or `undefined` if unset.

##### Returns

`string` \| `undefined`

***

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:149](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L149)

Number of registered skills.

##### Returns

`number`

***

### surfaceMode

#### Get Signature

> **get** **surfaceMode**(): [`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md) \| `undefined`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:77](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L77)

Registry-level default `surfaceMode`, or `undefined` if unset.

##### Returns

[`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md) \| `undefined`

## Methods

### clear()

> **clear**(): `void`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:154](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L154)

Drop all registrations.

#### Returns

`void`

***

### get()

> **get**(`id`): [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md) \| `undefined`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:134](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L134)

Look up by id. Returns undefined if not registered.

#### Parameters

##### id

`string`

#### Returns

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md) \| `undefined`

***

### has()

> **has**(`id`): `boolean`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:139](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L139)

True iff a skill with the given id is registered.

#### Parameters

##### id

`string`

#### Returns

`boolean`

***

### list()

> **list**(): readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

Defined in: [src/lib/injection-engine/SkillRegistry.ts:144](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L144)

All registered skills. Order matches registration order.

#### Returns

readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

***

### register()

> **register**(`skill`): `this`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:91](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L91)

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

Defined in: [src/lib/injection-engine/SkillRegistry.ts:107](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L107)

Replace an existing skill by id. Throws if id is not registered.

#### Parameters

##### id

`string`

##### skill

[`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

#### Returns

`this`

***

### resolveForSkill()

> **resolveForSkill**(`skillOrId`, `provider?`, `model?`): `"system-prompt"` \| `"tool-only"` \| `"both"`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:219](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L219)

Resolve the effective `surfaceMode` for a skill, applying the
cascade:

  1. If the skill's own `metadata.surfaceMode` is concrete
     (`'system-prompt'` / `'tool-only'` / `'both'`), return it.
     Per-skill explicit choice always wins.
  2. Else if the registry was constructed with a concrete
     `surfaceMode`, return that.
  3. Else delegate to `resolveSurfaceMode(provider, model)` using
     the explicit `provider` arg (or `this.providerHint` if
     omitted). Falls back to `'tool-only'` when no provider is
     known.

Forward-compat for Block C / v2.5 per-mode runtime routing: the
runtime calls this with the agent's provider + model to decide
how to materialize the skill's body into slots.

Throws if the skill is not registered (catches typos at the
caller site rather than silently resolving against a stranger).

#### Parameters

##### skillOrId

`string` \| [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)

A registered Skill `Injection` OR its `id`.

##### provider?

`string`

Provider name override (wins over `providerHint`).

##### model?

`string`

Model name for the per-provider attention rule.

#### Returns

`"system-prompt"` \| `"tool-only"` \| `"both"`

***

### toTools()

> **toTools**(): [`SkillToolPair`](/agentfootprint/api/generated/interfaces/SkillToolPair.md)

Defined in: [src/lib/injection-engine/SkillRegistry.ts:186](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L186)

Materialize the LLM-facing skill discovery tools from the current
registry contents. Returns `{ listSkills, readSkill }`:

  - `list_skills` — no-arg tool the LLM calls to enumerate
    `{ id, description }` for every registered skill. Lets the
    LLM discover skills without paying the prompt-token cost of
    a static catalog in the system prompt.

  - `read_skill({ id })` — activates the named skill for the
    NEXT iteration. The Agent's tool-calls subflow inspects this
    tool call by name and updates `scope.activatedInjectionIds`
    so the InjectionEngine on iter N+1 includes the skill in the
    active set (body lands in the system slot; gated tools land
    in the tools slot).

Both entries are `undefined` when the registry is empty — filter
before adding to a tool list:

  const { listSkills, readSkill } = registry.toTools();
  const tools = [listSkills, readSkill, ...other].filter(Boolean) as Tool[];

Composes with `gatedTools` from `agentfootprint/tool-providers`
so PermissionPolicy can scope which roles see the skill discovery
surface.

#### Returns

[`SkillToolPair`](/agentfootprint/api/generated/interfaces/SkillToolPair.md)

A `SkillToolPair` (`{ listSkills, readSkill }`).

***

### unregister()

> **unregister**(`id`): `this`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:128](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/SkillRegistry.ts#L128)

Remove a skill by id. No-op if not registered.

#### Parameters

##### id

`string`

#### Returns

`this`
