---
title: PermissionDecision
---

# Interface: PermissionDecision

Defined in: [src/provider-contract/types.ts:905](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L905)

## Properties

### gateId?

> `readonly` `optional` **gateId?**: `string`

Defined in: [src/provider-contract/types.ts:920](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L920)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [src/provider-contract/types.ts:918](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L918)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/provider-contract/types.ts:919](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L919)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/provider-contract/types.ts:927](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L927)

v2.12 — telemetry tag (machine-readable, stable across versions).
Surfaces on `agentfootprint.permission.halt.reason` for routing
alerts (e.g. `'security:exfiltration'` → PagerDuty,
`'cost:context-bloat'` → Slack channel).

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"halt"` \| `"gate_open"`

Defined in: [src/provider-contract/types.ts:917](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L917)

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

Defined in: [src/provider-contract/types.ts:941](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L941)

v2.12 — content delivered to the LLM as the synthetic `tool_result`
on `'deny'` and `'halt'`. When omitted, the two defaults differ:

- `'deny'` → `"[permission denied: ${rationale ?? 'policy'}]"`. The
  `rationale` IS shown to the model (deny lets the model recover, and
  the rationale is yours), so do not put anything in it the model must
  not read. With no rationale: `"[permission denied: policy]"`.
- `'halt'` → the deliberately generic
  `"Tool '${name}' is not available in this context."`.

Neither default ever uses `reason` (telemetry, not user-facing).
