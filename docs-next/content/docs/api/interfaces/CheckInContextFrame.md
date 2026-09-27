---
title: CheckInContextFrame
---

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L91)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L93)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L95)

A short, truncated summary of the piece (never the full payload).
