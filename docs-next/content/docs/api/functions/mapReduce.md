---
title: mapReduce
---

# Function: mapReduce()

> **mapReduce**(`opts`): [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/MapReduce.ts:70](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/patterns/MapReduce.ts#L70)

Build a MapReduce Runner. At run time:
  1. The splitter runs the consumer's `split(input, shardCount)` and
     packs the resulting N shards into a delimited string.
  2. Parallel fans out to N branches. Each branch's wrapper extracts
     its own shard from the packed input and feeds it to the shared
     LLMCall.
  3. The reducer combines the N branch outputs into the final string.

## Parameters

### opts

[`MapReduceOptions`](/docs/api/interfaces/MapReduceOptions)

## Returns

[`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>
