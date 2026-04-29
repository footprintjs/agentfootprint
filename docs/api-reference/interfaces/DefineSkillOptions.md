[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineSkillOptions

# Interface: DefineSkillOptions

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:84](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L84)

## Properties

### body

> `readonly` **body**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:89](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L89)

Body appended to the system-prompt slot once activated.

***

### description

> `readonly` **description**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:87](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L87)

Visible to the LLM via the activation tool's description.

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:85](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L85)

***

### refreshPolicy?

> `readonly` `optional` **refreshPolicy?**: [`RefreshPolicy`](/agentfootprint/api/generated/interfaces/RefreshPolicy.md)

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:107](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L107)

Re-deliver the body past a token threshold to defend against
long-context attention decay. Default: undefined (no refresh).

***

### surfaceMode?

> `readonly` `optional` **surfaceMode?**: [`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md)

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:102](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L102)

Where the body lands when activated. See `SurfaceMode`. Default
`'auto'` — the library resolves per provider via `resolveSurfaceMode`.

***

### tools?

> `readonly` `optional` **tools?**: readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:91](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L91)

Optional unlocked tools, added to the tools slot once activated.

***

### viaToolName?

> `readonly` `optional` **viaToolName?**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:97](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L97)

Override the activation tool name. Defaults to `'read_skill'`.
Multiple Skills sharing one activation tool is the common pattern;
the LLM picks WHICH skill via the tool's argument.
