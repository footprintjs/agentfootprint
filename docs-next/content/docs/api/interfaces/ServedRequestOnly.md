---
title: ServedRequestOnly
---

# Interface: ServedRequestOnly

Defined in: [src/lib/time-travel/servedView.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L226)

A line that was on the request and in no history.

## Properties

### reason

> `readonly` **reason**: `string`

Defined in: [src/lib/time-travel/servedView.ts:231](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L231)

Which library mechanism composed it — `'staged-refs-nudge'`, `'time-window-line'` (step T6b)
 or `'evidence-conclusion'` (the evidence gate's figures dial).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/servedView.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L227)

***

### text

> `readonly` **text**: `string`

Defined in: [src/lib/time-travel/servedView.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L228)
