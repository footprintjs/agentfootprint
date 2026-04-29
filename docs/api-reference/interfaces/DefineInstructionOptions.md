[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineInstructionOptions

# Interface: DefineInstructionOptions

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L34)

## Properties

### activeWhen?

> `readonly` `optional` **activeWhen?**: (`ctx`) => `boolean`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:45](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L45)

Predicate to decide activation. Synchronous; side-effect free.
If omitted, the instruction is always active (effectively a
Steering doc, but tagged with `'instructions'` flavor for
narrative semantics — use `defineSteering` for clearer intent).
Predicates that throw are skipped (fail-open) and reported via
`agentfootprint.context.evaluated`.

#### Parameters

##### ctx

[`InjectionContext`](/agentfootprint/api/generated/interfaces/InjectionContext.md)

#### Returns

`boolean`

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L36)

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L35)

***

### prompt

> `readonly` **prompt**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:47](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L47)

Instruction text. Lands in the slot specified by `slot` (default system-prompt).

***

### role?

> `readonly` `optional` **role?**: [`ContextRole`](/agentfootprint/api/generated/type-aliases/ContextRole.md)

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:67](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L67)

When `slot: 'messages'`, the role to use. Default `'system'`.
`'user'` is also valid; `'assistant'` and `'tool'` work in
principle but rarely make pedagogical sense.

***

### slot?

> `readonly` `optional` **slot?**: `"system-prompt"` \| `"messages"`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineInstruction.ts:61](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineInstruction.ts#L61)

Where the instruction lands.

- `'system-prompt'` (default) — appended to the system prompt.
  Lower attention than recent messages but always available.
- `'messages'` — appended as a recent message. **Higher attention
  weight** — the LLM reads recent messages more carefully than
  system-prompt text. Use this for guidance that MUST be salient
  on this turn (post-tool-result reminders, urgent corrections).

Same instruction object can target both slots in different agents
— the trigger semantics don't change.
