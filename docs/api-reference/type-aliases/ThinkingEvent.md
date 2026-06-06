[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ThinkingEvent

# Type Alias: ThinkingEvent

> **ThinkingEvent** = [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.turn_start"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.turn_end"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.iteration_start"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.agent.route_decided"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.stream.tool_start"`\] \| [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`"agentfootprint.stream.tool_end"`\]

Defined in: [src/recorders/observability/ThinkingRecorder.ts:36](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/ThinkingRecorder.ts#L36)

Subset of events the thinking renderer formats. Discriminated on `type`.
