---
title: CheckInContextFrame
---

# Interface: CheckInContextFrame

Defined in: [src/core/checkin.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L128)

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: [src/core/checkin.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L130)

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L132)

A short, truncated summary of the piece (never the full payload).
