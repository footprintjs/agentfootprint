[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / debate

# Function: debate()

> **debate**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Debate.ts:43](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/patterns/Debate.ts#L43)

Build a Debate Runner. One debate "round" = Proposer → Critic. After
N rounds, the Judge sees the final exchange and renders the verdict.
The Judge's output is the Runner's return value.

## Parameters

### opts

[`DebateOptions`](/agentfootprint/api/generated/interfaces/DebateOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
