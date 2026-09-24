[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / epochAt

# Function: epochAt()

> **epochAt**(`source`, `epoch`): [`EpochLocation`](/agentfootprint/api/generated/interfaces/EpochLocation.md) \| `undefined`

Defined in: [src/lib/time-travel/epochs.ts:298](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/epochs.ts#L298)

One epoch by number, or `undefined` when the run has no such iteration.

## Parameters

### source

`unknown`

### epoch

`number`

## Returns

[`EpochLocation`](/agentfootprint/api/generated/interfaces/EpochLocation.md) \| `undefined`

## Example

```ts
epochAt(agent.getSnapshot()!, 2)?.callRuntimeStageId; // 'call-llm#31'
```
