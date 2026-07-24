---
title: checkInDeclined
---

# Function: checkInDeclined()

> **checkInDeclined**(`input`): [`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

Defined in: [src/core/checkin.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L150)

Decline a pending check-in — the tool is NOT executed; the model receives
a `"declined by human: <note>"` tool result and adapts in-loop.

## Parameters

### input

[`CheckInDecisionInput`](/docs/api/interfaces/CheckInDecisionInput)

## Returns

[`CheckInDecision`](/docs/api/interfaces/CheckInDecision)

## Example

```ts
const decision = checkInDeclined({ by: 'alice@ops', note: 'amount too high' });
  const final = await agent.resume(outcome.checkpoint, decision);
```
