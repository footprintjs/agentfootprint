[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InnerCallRecord

# Interface: InnerCallRecord

Defined in: [src/core/runbook/dispatch.ts:27](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/dispatch.ts#L27)

One inner call, as the bridge recorded it.

## Properties

### outcome

> `readonly` **outcome**: `"ok"` \| `"absent"` \| `"error"`

Defined in: [src/core/runbook/dispatch.ts:29](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/dispatch.ts#L29)

***

### result?

> `readonly` `optional` **result?**: `unknown`

Defined in: [src/core/runbook/dispatch.ts:31](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/dispatch.ts#L31)

The raw returned value (`'ok'` and `'absent'` outcomes).

***

### tool

> `readonly` **tool**: `string`

Defined in: [src/core/runbook/dispatch.ts:28](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/dispatch.ts#L28)
