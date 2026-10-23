---
title: ServedRequestOnly
---

# Interface: ServedRequestOnly

Defined in: [src/time-travel/servedView.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L237)

A line that was on the request and in no history.

## Properties

### reason

> `readonly` **reason**: `string`

Defined in: [src/time-travel/servedView.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L242)

Which library mechanism composed it — `'staged-refs-nudge'`, `'time-window-line'` (step T6b)
 or `'evidence-conclusion'` (the evidence gate's figures dial).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/time-travel/servedView.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L238)

***

### text

> `readonly` **text**: `string`

Defined in: [src/time-travel/servedView.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L239)
