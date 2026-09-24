[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneOf

# Function: milestoneOf()

> **milestoneOf**(`stop`): [`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

Defined in: [src/lib/time-travel/milestoneStops.ts:75](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/milestoneStops.ts#L75)

The milestone a stop stands for, or `null` when it stands for none (the
`'start'` / `'end'` bookends).

A stop that [milestoneStops](/agentfootprint/api/generated/functions/milestoneStops.md) made carries its milestone as
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

[`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

## Example

```ts
const stop = cursor.at()!;
milestoneOf(stop)?.kind;   // 'llm-turn'
```
