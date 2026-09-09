---
title: milestoneOf
---

# Function: milestoneOf()

> **milestoneOf**(`stop`): [`Milestone`](/docs/api/interfaces/Milestone) \| `null`

Defined in: [src/lib/time-travel/milestoneStops.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/milestoneStops.ts#L78)

The milestone a stop stands for, or `null` when it stands for none (the
`'start'` / `'end'` bookends).

A stop that [milestoneStops](/docs/api/functions/milestoneStops) made carries its milestone as
`stop.meta`, and that is what is read — the classification the strategy
made when it put the stop on the axis, not a second run of the classifier.
A stop from ANOTHER strategy — the port's own `commitStops`, or a consumer's
filter that kept the stop without a milestone meta — has none, so the answer
falls back to where it always came from: `milestoneFor` over the stop's
`runtimeStageId`. Same classifier, same answer; a `meta` of some other
vocabulary is not mistaken for ours.

## Parameters

### stop

`Stop`\<`unknown`\>

## Returns

[`Milestone`](/docs/api/interfaces/Milestone) \| `null`

## Example

```ts
const stop = cursor.at()!;
milestoneOf(stop)?.kind;   // 'llm-turn'
```
