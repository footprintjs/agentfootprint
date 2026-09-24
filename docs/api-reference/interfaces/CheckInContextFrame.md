[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInContextFrame

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:86](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/checkin.ts#L86)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:88](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/checkin.ts#L88)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:90](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/checkin.ts#L90)

A short, truncated summary of the piece (never the full payload).
