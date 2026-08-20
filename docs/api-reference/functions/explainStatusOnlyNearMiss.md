[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / explainStatusOnlyNearMiss

# Function: explainStatusOnlyNearMiss()

> **explainStatusOnlyNearMiss**(`result`): `string` \| `undefined`

Defined in: [src/core/agent/toolEffects.ts:250](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/toolEffects.ts#L250)

Name the ONE near-miss a tool author is likeliest to write: a status-only
envelope with the `effects` marker left off — `{ content, status: 'denied' }`.
That shape is NOT an envelope (recognition demands the `effects` array;
see `ToolResultEnvelope`), and it stays data byte-for-byte — but a value
whose only keys are envelope keys AND whose `status` speaks the closed
outcome vocabulary is far more likely a dropped `effects: []` than a
coincidence, and letting it route like an undeclared result with no word
of why would be accepted-and-silently-wrong. Returns the teaching sentence
for the caller's dev-mode warning; `undefined` for every other value.
Diagnosis only — never changes what any value does.

## Parameters

### result

`unknown`

## Returns

`string` \| `undefined`
