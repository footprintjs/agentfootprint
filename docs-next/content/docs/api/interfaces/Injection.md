---
title: Injection
---

# Interface: Injection

Defined in: [src/lib/injection-engine/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L161)

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

Defined in: [src/lib/injection-engine/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L165)

Human-readable description (Lens / docs / debug).

***

### flavor

> `readonly` **flavor**: [`ContextSource`](/docs/api/type-aliases/ContextSource)

Defined in: [src/lib/injection-engine/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L167)

Observability tag. Drives Lens chip color + ContextRecorder source field.

***

### id

> `readonly` **id**: `string`

Defined in: [src/lib/injection-engine/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L163)

Unique id. Used for observability + de-duplication + LLM-activation lookup.

***

### inject

> `readonly` **inject**: [`InjectionContent`](/docs/api/interfaces/InjectionContent)

Defined in: [src/lib/injection-engine/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L171)

WHAT to contribute (one or more slots).

***

### metadata?

> `readonly` `optional` **metadata?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/lib/injection-engine/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L181)

Optional flavor-specific metadata. Engine ignores keys it doesn't
recognize; flavor factories use this for opt-in fields without
widening the Injection contract.

Known keys:
  - `surfaceMode` (Skill) — `'auto' | 'system-prompt' | 'tool-only' | 'both'`
  - `refreshPolicy` (Skill) — `{ afterTokens, via }`

***

### trigger

> `readonly` **trigger**: [`InjectionTrigger`](/docs/api/type-aliases/InjectionTrigger)

Defined in: [src/lib/injection-engine/types.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/types.ts#L169)

WHEN to activate.
