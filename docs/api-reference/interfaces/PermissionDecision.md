[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionDecision

# Interface: PermissionDecision

Defined in: [src/adapters/types.ts:370](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L370)

## Properties

### gateId?

> `readonly` `optional` **gateId?**: `string`

Defined in: [src/adapters/types.ts:385](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L385)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [src/adapters/types.ts:383](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L383)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/adapters/types.ts:384](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L384)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/adapters/types.ts:392](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L392)

v2.12 — telemetry tag (machine-readable, stable across versions).
Surfaces on `agentfootprint.permission.halt.reason` for routing
alerts (e.g. `'security:exfiltration'` → PagerDuty,
`'cost:context-bloat'` → Slack channel).

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"halt"` \| `"gate_open"`

Defined in: [src/adapters/types.ts:382](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L382)

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

Defined in: [src/adapters/types.ts:399](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L399)

v2.12 — content delivered to the LLM as the synthetic `tool_result`
on `'deny'` and `'halt'`. When omitted, defaults to a deliberately
generic `"Tool '${name}' is not available in this context."` —
NEVER falls back to `reason` (which is telemetry, not user-facing).
