[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / debate

# Function: debate()

> **debate**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Debate.ts:43](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/patterns/Debate.ts#L43)

Build a Debate Runner. One debate "round" = Proposer → Critic. After
N rounds, the Judge sees the final exchange and renders the verdict.
The Judge's output is the Runner's return value.

## Parameters

### opts

[`DebateOptions`](/agentfootprint/api/generated/interfaces/DebateOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
