---
title: ServedRequestOnly
---

# Interface: ServedRequestOnly

Defined in: [src/lib/time-travel/servedView.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L196)

A line that was on the request and in no history.

## Properties

### reason

> `readonly` **reason**: `string`

Defined in: [src/lib/time-travel/servedView.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L201)

Which library mechanism composed it — `'staged-refs-nudge'`, `'time-window-line'` (step T6b)
 or `'evidence-conclusion'` (the evidence gate's figures dial).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/servedView.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L197)

***

### text

> `readonly` **text**: `string`

Defined in: [src/lib/time-travel/servedView.ts:198](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L198)
