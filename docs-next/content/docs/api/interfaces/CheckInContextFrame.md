---
title: CheckInContextFrame
---

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L103)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L105)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L107)

A short, truncated summary of the piece (never the full payload).
