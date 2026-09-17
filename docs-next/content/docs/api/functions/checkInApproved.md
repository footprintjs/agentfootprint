---
title: checkInApproved
---

# Function: checkInApproved()

> **checkInApproved**(`input`): [`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

Defined in: [src/core/checkin.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L207)

Approve a pending check-in — the paused tool executes normally on resume.

## Parameters

### input

[`CheckInDecisionInput`](/docs/api/interfaces/CheckInDecisionInput)

## Returns

[`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

## Example

```ts
const decision = checkInApproved({ by: 'alice@ops', note: 'verified with customer' });
  const final = await agent.resume(outcome.checkpoint, decision);
```
