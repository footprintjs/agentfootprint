[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkInApproved

# Function: checkInApproved()

> **checkInApproved**(`input`): [`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

Defined in: [src/core/checkin.ts:138](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core/checkin.ts#L138)

Approve a pending check-in — the paused tool executes normally on resume.

## Parameters

### input

[`CheckInDecisionInput`](/agentfootprint/api/generated/interfaces/CheckInDecisionInput.md)

## Returns

[`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

## Example

```ts
const decision = checkInApproved({ by: 'alice@ops', note: 'verified with customer' });
  const final = await agent.resume(outcome.checkpoint, decision);
```
