---
title: ReliabilityFailFastPayload
---

# Interface: ReliabilityFailFastPayload

Defined in: [src/events/payloads.ts:703](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L703)

Fired when the rules loop (or the reliability gate chart) gives up via
a `fail-fast` decision. Superset shape: `phase`/`kind`/`attempt` are
always present; the remaining fields are populated by whichever site
emits (the loop carries `label`/`providerUsed`/`errorKind`; the gate
chart carries `reason`).

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:708](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L708)

1-indexed attempt counter at the point of failure.

***

### errorKind?

> `readonly` `optional` **errorKind?**: `string`

Defined in: [src/events/payloads.ts:716](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L716)

Classification of the failure being failed-fast on.

***

### errorMessage?

> `readonly` `optional` **errorMessage?**: `string`

Defined in: [src/events/payloads.ts:718](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L718)

Originating error message, when present.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/events/payloads.ts:706](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L706)

The matched rule's `kind` (machine-readable bucket).

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/events/payloads.ts:710](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L710)

Human-readable label of the matched rule (loop sites).

***

### phase

> `readonly` **phase**: `"pre-check"` \| `"post-decide"`

Defined in: [src/events/payloads.ts:704](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L704)

***

### providerUsed?

> `readonly` `optional` **providerUsed?**: `string`

Defined in: [src/events/payloads.ts:714](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L714)

Provider in use when the loop failed fast.

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/events/payloads.ts:712](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L712)

Free-form reason string (gate-chart sites).
