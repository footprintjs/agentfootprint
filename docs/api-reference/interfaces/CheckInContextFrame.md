[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInContextFrame

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:75](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/checkin.ts#L75)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:77](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/checkin.ts#L77)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:79](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/checkin.ts#L79)

A short, truncated summary of the piece (never the full payload).
