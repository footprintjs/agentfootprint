[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / tot

# Function: tot()

> **tot**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/ToT.ts:57](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/patterns/ToT.ts#L57)

Build a ToT Runner. At run time:
  1. Seed — treat the input message as the initial frontier of 1 thought.
  2. For each of `depth` iterations:
     a. Parallel fan-out: generate `branchingFactor` new thoughts.
     b. Score all new thoughts, keep top `beamWidth`, pass to next iteration.
  3. Return the single best-scoring thought from the final frontier.

## Parameters

### opts

[`ToTOptions`](/agentfootprint/api/generated/interfaces/ToTOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
