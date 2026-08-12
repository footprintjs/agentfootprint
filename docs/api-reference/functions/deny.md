[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / deny

# Function: deny()

> **deny**(`reason`): [`DenyOutcome`](/agentfootprint/api/generated/interfaces/DenyOutcome.md)

Defined in: [src/core/agent/middleware/outcomes.ts:66](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core/agent/middleware/outcomes.ts#L66)

Refuse the call.

For a tool the reason reaches the model verbatim, as the tool's result,
and the loop continues — the agent gets to adapt. For a message it
surfaces as a `MessageDeniedError`.

At the after-tool moment it means "the model does not get to read this" — the
tool has already run, so the refusal replaces what the model reads while
the run keeps the real result in the ledger. Refusing there hides an answer
from the model; it cannot un-happen a side effect, and it does not pretend
to.

## Parameters

### reason

`string`

## Returns

[`DenyOutcome`](/agentfootprint/api/generated/interfaces/DenyOutcome.md)
