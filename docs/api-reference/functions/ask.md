[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ask

# Function: ask()

> **ask**(`payload`): [`AskOutcome`](/agentfootprint/api/generated/interfaces/AskOutcome.md)

Defined in: [src/core/agent/middleware/outcomes.ts:85](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/middleware/outcomes.ts#L85)

Suspend the run and put the question to a person. Tool dispatch only —
`MessageOutcome` has no `ask` arm, so this cannot be returned from a
message middleware.

The answer is a decision, not a result: approve and the chain continues
and the REAL tool runs; decline and it becomes a denial the model reads.
A middleware never gets to write the answer itself.

## Parameters

### payload

[`AskPayload`](/agentfootprint/api/generated/interfaces/AskPayload.md)

## Returns

[`AskOutcome`](/agentfootprint/api/generated/interfaces/AskOutcome.md)
