---
title: CheckInContextFrame
---

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L135)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L137)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L139)

A short, truncated summary of the piece (never the full payload).
