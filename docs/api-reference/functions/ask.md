[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ask

# Function: ask()

> **ask**(`payload`): [`AskOutcome`](/agentfootprint/api/generated/interfaces/AskOutcome.md)

Defined in: [src/core/agent/middleware/outcomes.ts:85](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/middleware/outcomes.ts#L85)

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
