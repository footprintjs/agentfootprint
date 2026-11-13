---
title: CheckInContextFrame
---

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L104)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L106)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L108)

A short, truncated summary of the piece (never the full payload).
