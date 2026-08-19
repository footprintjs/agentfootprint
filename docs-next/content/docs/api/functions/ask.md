---
title: ask
---

# Function: ask()

> **ask**(`payload`): [`AskOutcome`](/docs/api/interfaces/AskOutcome)

Defined in: [src/core/agent/middleware/outcomes.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L86)

Suspend the run and put the question to a person. Tool dispatch only —
`MessageOutcome` has no `ask` arm, so this cannot be returned from a
message middleware.

The answer is a decision, not a result: approve and the chain continues
and the REAL tool runs; decline and it becomes a denial the model reads.
A middleware never gets to write the answer itself.

## Parameters

### payload

[`AskPayload`](/docs/api/interfaces/AskPayload)

## Returns

[`AskOutcome`](/docs/api/interfaces/AskOutcome)
