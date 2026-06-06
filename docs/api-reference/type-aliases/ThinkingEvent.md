[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ThinkingEvent

# Type Alias: ThinkingEvent

> **ThinkingEvent** = [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.turn_start"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.turn_end"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.iteration_start"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.route_decided"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.stream.tool_start"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.stream.tool_end"`\]

Defined in: [src/recorders/observability/ThinkingRecorder.ts:38](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/ThinkingRecorder.ts#L38)

Subset of events the thinking renderer formats. Discriminated on `type`.
