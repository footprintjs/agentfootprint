---
title: ServedRequestOnly
---

# Interface: ServedRequestOnly

Defined in: [src/time-travel/servedView.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L173)

A line that was on the request and in no history.

## Properties

### reason

> `readonly` **reason**: `string`

Defined in: [src/time-travel/servedView.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L178)

Which library mechanism composed it — `'staged-refs-nudge'`, `'time-window-line'` (step T6b)
 or `'evidence-conclusion'` (the evidence gate's figures dial).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/time-travel/servedView.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L174)

***

### text

> `readonly` **text**: `string`

Defined in: [src/time-travel/servedView.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts#L175)
