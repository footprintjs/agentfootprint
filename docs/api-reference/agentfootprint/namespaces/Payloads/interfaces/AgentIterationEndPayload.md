[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / AgentIterationEndPayload

# Interface: AgentIterationEndPayload

Defined in: [src/events/payloads.ts:116](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L116)

## Properties

### history?

> `readonly` `optional` **history?**: readonly `unknown`[]

Defined in: [src/events/payloads.ts:126](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L126)

Conversation history (LLM messages) at the END of this
 iteration. Captured by `agent.run()` for fault-tolerant
 resume — `RunCheckpointError.checkpoint` snapshots this so
 `agent.resumeOnError(...)` can replay from the last good
 iteration. Optional for back-compat with v2.x recorders that
 subscribed without expecting this field.

***

### iterIndex

> `readonly` **iterIndex**: `number`

Defined in: [src/events/payloads.ts:118](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L118)

***

### toolCallCount

> `readonly` **toolCallCount**: `number`

Defined in: [src/events/payloads.ts:119](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L119)

***

### turnIndex

> `readonly` **turnIndex**: `number`

Defined in: [src/events/payloads.ts:117](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L117)
