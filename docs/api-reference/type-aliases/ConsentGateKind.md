[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ConsentGateKind

# Type Alias: ConsentGateKind

> **ConsentGateKind** = `"checkIn"` \| `"ask"`

Defined in: [src/core/pause.ts:128](https://github.com/footprintjs/agentfootprint/blob/a056409d5d117d220bc61985a6eed33349eeca8f/src/core/pause.ts#L128)

The two pause kinds whose answer is a DECISION rather than a value.

A **`'checkIn'`** pause is the tool's own consent demand, and its identity is
the evidence pack. A **`'ask'`** pause is a `toolMiddleware`'s own question.
Both are answered with `checkInApproved()` / `checkInDeclined()`.

Everything else — `pauseHere()` / `askHuman()`, and the 3LO credential-consent
pause — is NOT a consent gate in this sense: there the human's answer either
IS the tool's result or is ignored entirely, and any value is accepted.
