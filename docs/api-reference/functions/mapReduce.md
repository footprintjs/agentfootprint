[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mapReduce

# Function: mapReduce()

> **mapReduce**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [agentfootprint/src/patterns/MapReduce.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L70)

Build a MapReduce Runner. At run time:
  1. The splitter runs the consumer's `split(input, shardCount)` and
     packs the resulting N shards into a delimited string.
  2. Parallel fans out to N branches. Each branch's wrapper extracts
     its own shard from the packed input and feeds it to the shared
     LLMCall.
  3. The reducer combines the N branch outputs into the final string.

## Parameters

### opts

[`MapReduceOptions`](/agentfootprint/api/generated/interfaces/MapReduceOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
