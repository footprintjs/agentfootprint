[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkInDeclined

# Function: checkInDeclined()

> **checkInDeclined**(`input`): [`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

Defined in: [src/core/checkin.ts:150](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/checkin.ts#L150)

Decline a pending check-in — the tool is NOT executed; the model receives
a `"declined by human: <note>"` tool result and adapts in-loop.

## Parameters

### input

[`CheckInDecisionInput`](/agentfootprint/api/generated/interfaces/CheckInDecisionInput.md)

## Returns

[`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

## Example

```ts
const decision = checkInDeclined({ by: 'alice@ops', note: 'amount too high' });
  const final = await agent.resume(outcome.checkpoint, decision);
```
