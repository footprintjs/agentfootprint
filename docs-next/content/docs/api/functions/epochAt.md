---
title: epochAt
---

# Function: epochAt()

> **epochAt**(`source`, `epoch`): [`EpochLocation`](/docs/api/interfaces/EpochLocation) \| `undefined`

Defined in: [src/lib/time-travel/epochs.ts:298](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L298)

One epoch by number, or `undefined` when the run has no such iteration.

## Parameters

### source

`unknown`

### epoch

`number`

## Returns

[`EpochLocation`](/docs/api/interfaces/EpochLocation) \| `undefined`

## Example

```ts
epochAt(agent.getSnapshot()!, 2)?.callRuntimeStageId; // 'call-llm#31'
```
