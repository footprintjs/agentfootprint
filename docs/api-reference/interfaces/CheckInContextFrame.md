[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInContextFrame

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:75](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/checkin.ts#L75)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:77](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/checkin.ts#L77)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:79](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/checkin.ts#L79)

A short, truncated summary of the piece (never the full payload).
