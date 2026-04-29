[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionTrigger

# Type Alias: InjectionTrigger

> **InjectionTrigger** = \{ `kind`: `"always"`; \} \| \{ `activeWhen`: (`ctx`) => `boolean`; `kind`: `"rule"`; \} \| \{ `kind`: `"on-tool-return"`; `toolName`: `string` \| `RegExp`; \} \| \{ `kind`: `"llm-activated"`; `viaToolName`: `string`; \}

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L30)

Discriminated union — exactly one of four kinds. Adding a new
trigger kind is one new variant; engine evaluator + Lens chip
naturally extend.

## Union Members

### Type Literal

\{ `kind`: `"always"`; \}

Always-on. Used for steering-doc-style injections.

***

### Type Literal

\{ `activeWhen`: (`ctx`) => `boolean`; `kind`: `"rule"`; \}

Predicate runs once per iteration. Most flexible.

***

### Type Literal

\{ `kind`: `"on-tool-return"`; `toolName`: `string` \| `RegExp`; \}

Activates after a specific tool returns. The "Dynamic ReAct" flavor —
 tool results steer the next iteration's prompt. `toolName` matches
 literally (string) or by regex.

***

### Type Literal

\{ `kind`: `"llm-activated"`; `viaToolName`: `string`; \}

Activates when the LLM calls a designated tool. The "Skill" flavor:
 `read_skill('billing')` activates the billing Skill for the next
 iteration.
