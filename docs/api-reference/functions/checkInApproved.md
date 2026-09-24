[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkInApproved

# Function: checkInApproved()

> **checkInApproved**(`input`): [`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

Defined in: [src/core/checkin.ts:207](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/checkin.ts#L207)

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
