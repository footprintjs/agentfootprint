---
title: AgentOutputSchemaValidationFailedPayload
---

# Interface: AgentOutputSchemaValidationFailedPayload

Defined in: [src/events/payloads.ts:641](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L641)

Emitted (v2.13) when the agent's final answer fails the agent's
configured `outputSchema` (the parser passed to
`Agent.create({...}).outputSchema(parser)`).

Scope: ONLY agent-level final-answer validation. Tool-input validation
(`LLMToolSchema.inputSchema`) is a different concern handled by
provider-side type checks; this event does NOT fire for tool-arg
validation failures.

Lives in the `agent.*` domain (parallel to `agent.turn_end`) because
final-answer validation is a turn-level concern, not a generic
evaluation metric.

Pairs with `agentfootprint.error.retried` (when a reliability rule
routes the failure to retry with feedback) or
`agentfootprint.reliability.fail_fast` (when retries are exhausted).

The event is the OBSERVABILITY signal — it fires on EVERY validation
failure, regardless of whether retries are configured. Use the
`attempt` + `cumulativeRetries` fields to drive operator dashboards
for retry-rate trending (a leading indicator for model drift).

Fires BEFORE PostDecide rules evaluate, so observability sees the
failure even if a buggy rule routes to fail-fast or swallows it.

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:657](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L657)

1-indexed attempt counter. `1` for the first failure, `2` for the
 retry that also failed, etc.

***

### cumulativeRetries

> `readonly` **cumulativeRetries**: `number`

Defined in: [src/events/payloads.ts:662](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L662)

Total output-schema failures in this gate execution. Same as
 `validationErrorHistory.length`. Distinct from `attempt` because a
 gate can also retry on non-validation errors (5xx, etc.) — this
 counts ONLY the schema-driven failures.

***

### message

> `readonly` **message**: `string`

Defined in: [src/events/payloads.ts:643](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L643)

Validation error message (from Zod / parser).

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [src/events/payloads.ts:651](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L651)

Failing field path when the parser exposes one (e.g. `'amount.currency'`).
 Only set when `stage === 'schema-validate'`.

***

### rawOutput?

> `readonly` `optional` **rawOutput?**: `string`

Defined in: [src/events/payloads.ts:654](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L654)

The raw string output that failed — useful for narrative entries showing
 "what the model actually said" alongside the validation error.

***

### stage

> `readonly` **stage**: `"json-parse"` \| `"schema-validate"`

Defined in: [src/events/payloads.ts:648](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L648)

Validation stage — JSON parse vs schema validate. Lets dashboards
 distinguish "model emitted prose" (`json-parse`) from "model emitted
 JSON but wrong shape" (`schema-validate`); they trend differently
 under model drift.
