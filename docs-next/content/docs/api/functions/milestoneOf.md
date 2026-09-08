---
title: milestoneOf
---

# Function: milestoneOf()

> **milestoneOf**(`stop`): [`Milestone`](/docs/api/interfaces/Milestone) \| `null`

Defined in: [src/lib/time-travel/milestoneStops.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/milestoneStops.ts#L54)

The milestone a stop stands for, or `null` when it stands for none (the
`'start'` / `'end'` bookends).

WHY A FUNCTION AND NOT A FIELD. footprintjs's `Stop` is a closed shape —
`step`, `runtimeStageId`, `commitIdx`, `lastCommitIdx`, `stageId`,
`subflowPath`, `label`, `kind` — with no extension slot a strategy may write
its own vocabulary into, and `kind` is the port's own `StopKind`
(`'commit' | 'mount' | 'start' | 'end'`), not ours to overload. So the
milestone kind travels the only way it honestly can: re-derived from the
stop's `runtimeStageId`, by the same classifier that put the stop on the
axis. Same input, same function, same answer — there is no second source of
truth here, only a second reading of the one there is.

## Parameters

### stop

`Stop`

## Returns

[`Milestone`](/docs/api/interfaces/Milestone) \| `null`

## Example

```ts
const stop = cursor.at()!;
milestoneOf(stop)?.kind;   // 'llm-turn'
```
