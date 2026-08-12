[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkInDeclined

# Function: checkInDeclined()

> **checkInDeclined**(`input`): [`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

Defined in: [src/core/checkin.ts:150](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core/checkin.ts#L150)

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
