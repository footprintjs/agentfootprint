---
title: readAskComponent
---

# Function: readAskComponent()

> **readAskComponent**(`pauseData`): [`AskComponent`](/docs/api/interfaces/AskComponent) \| `undefined`

Defined in: [src/core/askComponent.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/askComponent.ts#L174)

The ONE reader of `component` on a pause payload — wherever the pause kind
happens to keep it.

A plain `askHuman` / `pauseHere` pause carries it at the TOP of `pauseData`
(the tool's own bag, spread by the dispatch loop); a check-in keeps it on
the typed request under `pauseData.checkIn`; a middleware ask keeps it on
the question under `pauseData.ask`. The kinds are mutually exclusive, so at
most one home is occupied — and every consumer that wants "the component of
this pause, whatever kind it is" asks HERE, so the homes cannot drift apart
from their readers.

Duck-shaped on purpose (`pauseData` is uninterpreted caller data): a value
that is not a plausible component is reported absent, never guessed at.

## Parameters

### pauseData

`unknown`

## Returns

[`AskComponent`](/docs/api/interfaces/AskComponent) \| `undefined`
