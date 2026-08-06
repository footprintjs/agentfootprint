[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkInApproved

# Function: checkInApproved()

> **checkInApproved**(`input`): [`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

Defined in: [src/core/checkin.ts:138](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/checkin.ts#L138)

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
