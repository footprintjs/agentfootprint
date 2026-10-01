---
title: CheckInTrail
---

# Interface: CheckInTrail

Defined in: src/core/checkin.ts:112

A compact grouped summary of the run so far.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/checkin.ts:114

Which ReAct iteration this check-in fired on.

***

### summary

> `readonly` **summary**: `string`

Defined in: src/core/checkin.ts:118

One-line human summary, e.g. `"3 tools run over 2 iterations"`.

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: src/core/checkin.ts:116

The tool calls already completed this run, oldest first.
