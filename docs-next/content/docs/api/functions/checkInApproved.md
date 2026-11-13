---
title: checkInApproved
---

# Function: checkInApproved()

> **checkInApproved**(`input`): [`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

Defined in: [src/core/checkin.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L251)

Approve a pending check-in — the paused tool executes normally on resume.

The decision names the request it answers (`request.id`), so it answers that
request once and no other: a resume refuses it on a different pause, on a
call that changed after the ask, or a second time (`ResumeDecisionError`).

## Parameters

### input

[`CheckInDecisionInput`](/docs/api/interfaces/CheckInDecisionInput)

## Returns

[`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

## Throws

TypeError when `request` is not a paused request (it has no `id`).

## Example

```ts
const decision = checkInApproved({
    request: outcome.checkIn,
    by: 'alice@ops',
    note: 'verified with customer',
  });
  const final = await agent.resume(outcome.checkpoint, decision);
```
