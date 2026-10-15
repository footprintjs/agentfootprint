---
title: OutputAttempt
---

# Interface: OutputAttempt

Defined in: [src/core/agent/outputEnforcement.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L55)

One row per final-answer attempt an enforcing agent made, in order.

Rows exist ONLY on an agent that opted into `retries`. Without the option
the schema is judged after the run as it always was, nothing in the loop
looks at it, and this key is never written.

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/core/agent/outputEnforcement.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L57)

1-based attempt number within this run.

***

### brokenBy?

> `readonly` `optional` **brokenBy?**: `string`

Defined in: [src/core/agent/outputEnforcement.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L88)

Set on an `'exhausted'` row when the answer the MODEL produced satisfied
the schema and an `act({ output })` middleware's rewrite broke it — the
name of that middleware (8.18.0).

Its presence is also why the row is `'exhausted'` with retries still on
the clock: a rule that turns a valid answer into an invalid one will do it
to the next answer too, so the run stops paying for re-asks that cannot
converge.

***

### correctiveMessageHash?

> `readonly` `optional` **correctiveMessageHash?**: `string`

Defined in: [src/core/agent/outputEnforcement.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L77)

`fnv1a` of the corrective message this row's failure produced. Present
 only on a `'retried'` row — it is the join back to the message in the
 conversation and to the `output_schema_retry` event's payload.

***

### error?

> `readonly` `optional` **error?**: `string`

Defined in: [src/core/agent/outputEnforcement.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L71)

The validator's own message, verbatim. Absent on a passing row.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/outputEnforcement.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L59)

The ReAct iteration that produced the answer.

***

### outcome

> `readonly` **outcome**: `"retried"` \| `"passed"` \| `"exhausted"`

Defined in: [src/core/agent/outputEnforcement.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L67)

What became of this attempt:
  • `'passed'`    — the answer satisfied the schema; the run returns it.
  • `'retried'`   — it failed and a corrective turn was sent.
  • `'exhausted'` — it failed with no retries left; this answer stands,
                    and `runTyped()` throws on it exactly as it always did.

***

### path?

> `readonly` `optional` **path?**: `string`

Defined in: [src/core/agent/outputEnforcement.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L73)

Failing field path when the parser exposes one (Zod-style issues).

***

### stage?

> `readonly` `optional` **stage?**: `"json-parse"` \| `"schema-validate"`

Defined in: [src/core/agent/outputEnforcement.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L69)

Which half of validation failed. Absent on a passing row.

***

### stopReason?

> `readonly` `optional` **stopReason?**: `NativeStopReason`

Defined in: [src/core/agent/outputEnforcement.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/outputEnforcement.ts#L96)

Set when the attempt failed because the provider STOPPED, not because the
text failed the parser: a `strategy: 'native'` answer that ended with a
NativeStopReason, where the structured-output format does not
hold. Such an answer fails even when it parses; a `'refusal'` is never
re-asked (the row is `'exhausted'` at once).
