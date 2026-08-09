[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / llmSwarm

# Function: llmSwarm()

> **llmSwarm**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/LlmSwarm.ts:104](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/patterns/LlmSwarm.ts#L104)

Build a swarm whose hand-offs are decided by an LLM.

Halting: the router omits `agentId` when it judges the work done — the
swarm stops and that decision's `message` is the answer. An id that is
not in the roster follows `swarm()`'s existing law (the `done` fallback
echoes the message and the loop guard halts), so a hallucinated agent
ends the run instead of silently picking someone.

Watching it: subscribe to `agentfootprint.composition.route_decided` —
every decision arrives with the chosen id, a rationale, and the model's
own `reason` as evidence. (That reason stays in the trace; it is never
fed back into a prompt.)

## Parameters

### opts

[`LlmSwarmOptions`](/agentfootprint/api/generated/interfaces/LlmSwarmOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
