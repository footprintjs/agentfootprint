[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mapReduce

# Function: mapReduce()

> **mapReduce**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/MapReduce.ts:70](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/patterns/MapReduce.ts#L70)

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
