[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / tot

# Function: tot()

> **tot**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/ToT.ts:57](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/patterns/ToT.ts#L57)

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
