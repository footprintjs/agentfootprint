---
title: CheckInContextFrame
---

# Interface: CheckInContextFrame

Defined in: src/core/checkin.ts:75

One piece of context the run consumed — role/channel + a compact summary.

## Properties

### channel

> `readonly` **channel**: `string`

Defined in: src/core/checkin.ts:77

Origin group: `'system' | 'task' | 'result'`.

***

### summary

> `readonly` **summary**: `string`

Defined in: src/core/checkin.ts:79

A short, truncated summary of the piece (never the full payload).
