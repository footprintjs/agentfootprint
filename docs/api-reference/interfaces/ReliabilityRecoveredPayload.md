[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ReliabilityRecoveredPayload

# Interface: ReliabilityRecoveredPayload

Defined in: [src/events/payloads.ts:640](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L640)

Fired when the rules loop produces a successful response AFTER one or
more failed attempts (self-healed). `recoveredVia` names the mechanism
of the final successful step.

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:642](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L642)

1-indexed attempt number that finally succeeded.

***

### errorKind

> `readonly` **errorKind**: `string`

Defined in: [src/events/payloads.ts:648](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L648)

Classification of the LAST failure before recovery.

***

### priorFailures

> `readonly` **priorFailures**: `number`

Defined in: [src/events/payloads.ts:646](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L646)

How many attempts failed before this success.

***

### recoveredVia

> `readonly` **recoveredVia**: `"retry"` \| `"retry-other"` \| `"fallback"`

Defined in: [src/events/payloads.ts:644](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L644)

How recovery happened.
