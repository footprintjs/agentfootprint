[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / swarm

# Function: swarm()

> **swarm**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Swarm.ts:62](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/patterns/Swarm.ts#L62)

Build a Swarm Runner. Each iteration:
  1. Router evaluates `route(input)` to pick an agent id.
  2. Conditional dispatches to that agent's runner.
  3. Agent's output becomes the next iteration's input.
Loop halts when `route` returns a halt-sentinel id (or unknown id
falling to the `done` branch) OR when `maxHandoffs` is reached.

## Parameters

### opts

[`SwarmOptions`](/agentfootprint/api/generated/interfaces/SwarmOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
