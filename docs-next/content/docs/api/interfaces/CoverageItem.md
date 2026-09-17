---
title: CoverageItem
---

# Interface: CoverageItem

Defined in: [src/core/agent/coverage/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L22)

One piece of ground, and (optionally) why it is where it is.

`what` is prose the TOOL AUTHOR wrote — a source, a window, a filter, a
fleet ("the fcns database on shq-fab-a", "the last 24h", "all four
arrays"). It is never composed from the model's arguments by this library,
because the library does not know which of them are real.

## Properties

### what

> `readonly` **what**: `string`

Defined in: [src/core/agent/coverage/types.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L24)

The source, window, filter or population. Non-empty.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/coverage/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L31)

Why it sits where it does. REQUIRED on `cannotCover` (a permanent blind
spot is a claim about capability, and a claim with no reason cannot be
acted on or disproved); optional on `checked` and `notChecked`, where
"we did" and "we did not need to" are often the whole story.
