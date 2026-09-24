[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / requestInput

# Function: requestInput()

> **requestInput**(`declaration`): `never`

Defined in: [src/core/pause.ts:110](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/pause.ts#L110)

Collect declared fields using a dedicated tool. The query itself runs afterwards.

When a lookup does raise about its own miss (the dedicated collection tool
stays the documented shape), it still declares what it looked at
(9.114.0): pass the envelope `absent()` returns as `absence`. The dispatch
door files it at the raise — the rows a returned `absent(…)` files — and it
never rides `awaitingInput`. A value the absence recognizer cannot read
throws `InputRequestError` here (`absence: null` is the field omitted); an
envelope it reads whose lists cannot be copied (a hand-built
`checked: [null]`) errors the call at the door instead of pausing, as the
same value returned would.

## Parameters

### declaration

[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md)

## Returns

`never`
