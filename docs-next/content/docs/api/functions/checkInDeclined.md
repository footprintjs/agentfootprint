---
title: checkInDeclined
---

# Function: checkInDeclined()

> **checkInDeclined**(`input`): [`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

Defined in: [src/core/checkin.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L272)

Decline a pending check-in — the tool is NOT executed; the model receives
a `"declined by human: <note>"` tool result and adapts in-loop.

A decline is an answer too: it names its request and spends it, so an
approval presented for the same request afterwards is refused.

## Parameters

### input

[`CheckInDecisionInput`](/docs/api/interfaces/CheckInDecisionInput)

## Returns

[`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

## Throws

TypeError when `request` is not a paused request (it has no `id`).

## Example

```ts
const decision = checkInDeclined({
    request: outcome.checkIn,
    by: 'alice@ops',
    note: 'amount too high',
  });
  const final = await agent.resume(outcome.checkpoint, decision);
```
