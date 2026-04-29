[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Injection

# Interface: Injection

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L134)

THE primitive. Five fields. Four trigger kinds. Three slot targets.

Every named flavor (Skill, Steering, Instruction, Context, RAG,
Memory, Guardrail, …) is a sugar factory that produces one of these.

## Example

```ts
// Direct construction (power user)
  const myInjection: Injection = {
    id: 'demo',
    flavor: 'instructions',
    trigger: { kind: 'rule', activeWhen: (ctx) => ctx.iteration > 1 },
    inject: { systemPrompt: 'Refine the previous answer.' },
  };

  // Sugar (recommended)
  const myInjection2 = defineInstruction({
    id: 'demo',
    activeWhen: (ctx) => ctx.iteration > 1,
    prompt: 'Refine the previous answer.',
  });
```

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L138)

Human-readable description (Lens / docs / debug).

***

### flavor

> `readonly` **flavor**: [`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md)

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L140)

Observability tag. Drives Lens chip color + ContextRecorder source field.

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L136)

Unique id. Used for observability + de-duplication + LLM-activation lookup.

***

### inject

> `readonly` **inject**: [`InjectionContent`](/agentfootprint/api/generated/interfaces/InjectionContent.md)

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L144)

WHAT to contribute (one or more slots).

***

### metadata?

> `readonly` `optional` **metadata?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L154)

Optional flavor-specific metadata. Engine ignores keys it doesn't
recognize; flavor factories use this for opt-in fields without
widening the Injection contract.

Known keys:
  - `surfaceMode` (Skill) — `'auto' | 'system-prompt' | 'tool-only' | 'both'`
  - `refreshPolicy` (Skill) — `{ afterTokens, via }`

***

### trigger

> `readonly` **trigger**: [`InjectionTrigger`](/agentfootprint/api/generated/type-aliases/InjectionTrigger.md)

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L142)

WHEN to activate.
