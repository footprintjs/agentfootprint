[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isCheckInPause

# Function: isCheckInPause()

> **isCheckInPause**(`result`): `result is RunnerPauseOutcome & { checkIn: CheckInRequest }`

Defined in: [src/core/pause.ts:89](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/pause.ts#L89)

Type guard — is this a check-in pause (evidence-carrying human consent),
as opposed to a plain `askHuman` pause? Narrows `checkIn` to present.

## Parameters

### result

`unknown`

## Returns

`result is RunnerPauseOutcome & { checkIn: CheckInRequest }`

## Example

```ts
const out = await agent.run({ message });
  if (isCheckInPause(out)) {
    showToHuman(out.checkIn.evidence);       // the receipts
    const decision = checkInApproved({ by: 'alice' });
    await agent.resume(out.checkpoint, decision);
  }
```
