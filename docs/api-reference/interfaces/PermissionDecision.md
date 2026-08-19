[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionDecision

# Interface: PermissionDecision

Defined in: [src/adapters/types.ts:760](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L760)

## Properties

### gateId?

> `readonly` `optional` **gateId?**: `string`

Defined in: [src/adapters/types.ts:775](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L775)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [src/adapters/types.ts:773](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L773)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/adapters/types.ts:774](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L774)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/adapters/types.ts:782](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L782)

v2.12 — telemetry tag (machine-readable, stable across versions).
Surfaces on `agentfootprint.permission.halt.reason` for routing
alerts (e.g. `'security:exfiltration'` → PagerDuty,
`'cost:context-bloat'` → Slack channel).

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"halt"` \| `"gate_open"`

Defined in: [src/adapters/types.ts:772](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L772)

v2.12 — `'halt'` is NEW. Terminates the run cleanly with a typed
`PolicyHaltError`. The framework writes a synthetic `tool_result`
(using `tellLLM`) to `scope.history` BEFORE throwing, so:
  • Anthropic / OpenAI tool_use ↔ tool_result pairing is satisfied
  • The conversation history is consistent for `resumeOnError`
  • Lens / `getNarrative()` shows what the LLM was told

`'deny'` keeps existing semantics: synthetic tool_result + LLM
continues and can pick differently.

***

### tellLLM?

> `readonly` `optional` **tellLLM?**: `string`

Defined in: [src/adapters/types.ts:789](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/adapters/types.ts#L789)

v2.12 — content delivered to the LLM as the synthetic `tool_result`
on `'deny'` and `'halt'`. When omitted, defaults to a deliberately
generic `"Tool '${name}' is not available in this context."` —
NEVER falls back to `reason` (which is telemetry, not user-facing).
