---
title: DefineInstructionOptions
---

# Interface: DefineInstructionOptions

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L36)

## Properties

### activeWhen?

> `readonly` `optional` **activeWhen?**: (`ctx`) => `boolean`

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L47)

Predicate to decide activation. Synchronous; side-effect free.
If omitted, the instruction is always active (effectively a
Steering doc, but tagged with `'instructions'` flavor for
narrative semantics — use `defineSteering` for clearer intent).
Predicates that throw are skipped (fail-open) and reported via
`agentfootprint.context.evaluated`.

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`boolean`

***

### cache?

> `readonly` `optional` **cache?**: `CachePolicy`

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L79)

Cache policy for this instruction. Defaults to `'never'` —
instructions are typically rule-based (volatile per-iter
`activeWhen` predicates, on-tool-return reminders). Override to
`'always'` only for instructions you know are stable per-turn
(e.g., a static safety rule wrapped as `defineInstruction` for
narrative tagging — though `defineSteering` is the cleaner choice
for that case).

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L38)

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L37)

***

### prompt

> `readonly` **prompt**: `string`

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L49)

Instruction text. Lands in the slot specified by `slot` (default system-prompt).

***

### role?

> `readonly` `optional` **role?**: [`ContextRole`](/docs/api/type-aliases/ContextRole)

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L69)

When `slot: 'messages'`, the role to use. Default `'system'`.
`'user'` is also valid; `'assistant'` and `'tool'` work in
principle but rarely make pedagogical sense.

***

### slot?

> `readonly` `optional` **slot?**: `"system-prompt"` \| `"messages"`

Defined in: [src/lib/injection-engine/factories/defineInstruction.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/factories/defineInstruction.ts#L63)

Where the instruction lands.

- `'system-prompt'` (default) — appended to the system prompt.
  Lower attention than recent messages but always available.
- `'messages'` — appended as a recent message. **Higher attention
  weight** — the LLM reads recent messages more carefully than
  system-prompt text. Use this for guidance that MUST be salient
  on this turn (post-tool-result reminders, urgent corrections).

Same instruction object can target both slots in different agents
— the trigger semantics don't change.
