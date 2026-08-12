[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / checkInDeclined

# Function: checkInDeclined()

> **checkInDeclined**(`input`): [`CheckInDecision`](/agentfootprint/api/generated/interfaces/CheckInDecision.md)

Defined in: [src/core/checkin.ts:150](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/checkin.ts#L150)

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
