[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SkillRegistryOptions

# Interface: SkillRegistryOptions

Defined in: [src/lib/injection-engine/SkillRegistry.ts:37](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/injection-engine/SkillRegistry.ts#L37)

Options for `new SkillRegistry({...})`. All fields are optional;
the empty-object form (`new SkillRegistry()`) is the v2.4 surface.

## See

SkillRegistry.resolveForSkill — applies the cascade

## Properties

### providerHint?

> `readonly` `optional` **providerHint?**: `string`

Defined in: [src/lib/injection-engine/SkillRegistry.ts:60](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/injection-engine/SkillRegistry.ts#L60)

Provider name used as a hint when resolving `surfaceMode: 'auto'`
inside this registry. Most consumers don't set this — runtime code
passes the provider name into `resolveForSkill(skill, provider, model)`
directly. This field is for cases where the registry is composed
far from the agent (test fixtures, design-time inspectors).

Match the provider's `name` field — `'anthropic'`, `'openai'`,
`'mock'`, etc.

***

### surfaceMode?

> `readonly` `optional` **surfaceMode?**: [`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md)

Defined in: [src/lib/injection-engine/SkillRegistry.ts:48](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/injection-engine/SkillRegistry.ts#L48)

Registry-level default `surfaceMode`. Applies to skills whose own
`surfaceMode` is `'auto'` (the `defineSkill` default). Per-skill
`surfaceMode` always wins; this is the fallback BEFORE the global
`resolveSurfaceMode(provider, model)` rule.

Use case: a registry shared across agents pointed at the same
provider can lock surfaceMode here once instead of repeating it
on every `defineSkill`.
