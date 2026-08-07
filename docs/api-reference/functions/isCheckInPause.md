[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isCheckInPause

# Function: isCheckInPause()

> **isCheckInPause**(`result`): `result is RunnerPauseOutcome & { checkIn: CheckInRequest }`

Defined in: [src/core/pause.ts:89](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/core/pause.ts#L89)

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
