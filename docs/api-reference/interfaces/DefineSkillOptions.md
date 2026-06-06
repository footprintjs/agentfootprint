[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineSkillOptions

# Interface: DefineSkillOptions

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:87](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L87)

## Properties

### autoActivate?

> `readonly` `optional` **autoActivate?**: `"currentSkill"`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:129](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L129)

Per-skill tool gating intent. Block A5 / v2.5.

- `'currentSkill'` — when this Skill is the only active one, the
  agent's tool list should narrow to this Skill's `tools` (plus
  the consumer-composed baseline). Used with
  `skillScopedTools(id, tools)` from `agentfootprint/tool-providers`
  to materialize the gate. Block C wires this into the runtime
  automatically.
- `undefined` (default) — current additive behavior: this Skill's
  tools are added to the agent's registry on activation, alongside
  every other tool already registered.

The field is a forward-compat marker today: the metadata stores
it; consumers can read `skill.metadata.autoActivate` to drive
their own ToolProvider composition. v2.5 runtime wiring builds
on this contract without API change.

***

### body

> `readonly` **body**: `string`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:92](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L92)

Body appended to the system-prompt slot once activated.

***

### cache?

> `readonly` `optional` **cache?**: `CachePolicy`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:143](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L143)

Cache policy for this skill's body. Defaults to `'while-active'` —
the body caches while the skill is in `activeInjections[]` (i.e.,
while it's the most-recently-activated skill); invalidates the
moment it deactivates.

For skills with stable, frequently-accessed bodies, consider
`'always'` to keep the body cached even when temporarily inactive.
For skills with bodies that depend on per-iter state, use
`'never'` or `{ until: ... }`.

See `CachePolicy` in `agentfootprint/src/cache/types.ts`.

***

### description

> `readonly` **description**: `string`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:90](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L90)

Visible to the LLM via the activation tool's description.

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:88](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L88)

***

### refreshPolicy?

> `readonly` `optional` **refreshPolicy?**: [`RefreshPolicy`](/agentfootprint/api/generated/interfaces/RefreshPolicy.md)

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:110](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L110)

Re-deliver the body past a token threshold to defend against
long-context attention decay. Default: undefined (no refresh).

***

### surfaceMode?

> `readonly` `optional` **surfaceMode?**: [`SurfaceMode`](/agentfootprint/api/generated/type-aliases/SurfaceMode.md)

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:105](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L105)

Where the body lands when activated. See `SurfaceMode`. Default
`'auto'` — the library resolves per provider via `resolveSurfaceMode`.

***

### tools?

> `readonly` `optional` **tools?**: readonly [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:94](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L94)

Optional unlocked tools, added to the tools slot once activated.

***

### viaToolName?

> `readonly` `optional` **viaToolName?**: `string`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:100](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L100)

Override the activation tool name. Defaults to `'read_skill'`.
Multiple Skills sharing one activation tool is the common pattern;
the LLM picks WHICH skill via the tool's argument.
