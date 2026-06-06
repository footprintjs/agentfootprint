[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / ReliabilityFailFastPayload

# Interface: ReliabilityFailFastPayload

Defined in: [src/events/payloads.ts:598](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L598)

Fired when the rules loop (or the reliability gate chart) gives up via
a `fail-fast` decision. Superset shape: `phase`/`kind`/`attempt` are
always present; the remaining fields are populated by whichever site
emits (the loop carries `label`/`providerUsed`/`errorKind`; the gate
chart carries `reason`).

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:603](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L603)

1-indexed attempt counter at the point of failure.

***

### errorKind?

> `readonly` `optional` **errorKind?**: `string`

Defined in: [src/events/payloads.ts:611](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L611)

Classification of the failure being failed-fast on.

***

### errorMessage?

> `readonly` `optional` **errorMessage?**: `string`

Defined in: [src/events/payloads.ts:613](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L613)

Originating error message, when present.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/events/payloads.ts:601](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L601)

The matched rule's `kind` (machine-readable bucket).

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/events/payloads.ts:605](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L605)

Human-readable label of the matched rule (loop sites).

***

### phase

> `readonly` **phase**: `"pre-check"` \| `"post-decide"`

Defined in: [src/events/payloads.ts:599](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L599)

***

### providerUsed?

> `readonly` `optional` **providerUsed?**: `string`

Defined in: [src/events/payloads.ts:609](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L609)

Provider in use when the loop failed fast.

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/events/payloads.ts:607](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L607)

Free-form reason string (gate-chart sites).
