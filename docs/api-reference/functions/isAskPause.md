[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isAskPause

# Function: isAskPause()

> **isAskPause**(`result`): `result is RunnerPauseOutcome & { ask: MiddlewareAsk }`

Defined in: [src/core/pause.ts:109](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/pause.ts#L109)

Type guard — is this a middleware-ask pause (a `toolMiddleware` answered
`ask`), as opposed to a check-in or a plain `askHuman` pause? Narrows `ask`
to present.

## Parameters

### result

`unknown`

## Returns

`result is RunnerPauseOutcome & { ask: MiddlewareAsk }`

## Example

```ts
const out = await agent.run({ message });
  if (isAskPause(out)) {
    const yes = await showToHuman(out.ask.question);      // asked by out.ask.middleware
    await agent.resume(out.checkpoint, yes
      ? checkInApproved({ by: 'alice' })
      : checkInDeclined({ by: 'alice', note: 'not this one' }));
  }
```
