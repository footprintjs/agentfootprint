---
title: tot
---

# Function: tot()

> **tot**(`opts`): [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/ToT.ts:57](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/patterns/ToT.ts#L57)

Build a ToT Runner. At run time:
  1. Seed — treat the input message as the initial frontier of 1 thought.
  2. For each of `depth` iterations:
     a. Parallel fan-out: generate `branchingFactor` new thoughts.
     b. Score all new thoughts, keep top `beamWidth`, pass to next iteration.
  3. Return the single best-scoring thought from the final frontier.

## Parameters

### opts

[`ToTOptions`](/docs/api/interfaces/ToTOptions)

## Returns

[`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>
