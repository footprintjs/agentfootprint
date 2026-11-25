---
title: PermissionDecision
---

# Interface: PermissionDecision

Defined in: [src/provider-contract/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L151)

## Properties

### gateId?

> `readonly` `optional` **gateId?**: `string`

Defined in: [src/provider-contract/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L166)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [src/provider-contract/types.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L164)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/provider-contract/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L165)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/provider-contract/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L173)

v2.12 — telemetry tag (machine-readable, stable across versions).
Surfaces on `agentfootprint.permission.halt.reason` for routing
alerts (e.g. `'security:exfiltration'` → PagerDuty,
`'cost:context-bloat'` → Slack channel).

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"halt"` \| `"gate_open"`

Defined in: [src/provider-contract/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L163)

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

Defined in: [src/provider-contract/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L180)

v2.12 — content for the synthetic `tool_result` on an explicit deny or halt.
A deny defaults to `"[permission denied: ${rationale ?? 'policy'}]"`. The
rationale can reach the model. A halt defaults to `"Tool '${name}' is not
available in this context."` Both defaults leave `reason` in telemetry.
