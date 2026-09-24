[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / stageRole

# Function: stageRole()

> **stageRole**(`id`): [`StageRole`](/agentfootprint/api/generated/type-aliases/StageRole.md)

Defined in: [src/conventions.ts:352](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/conventions.ts#L352)

Classify a stage id into its [StageRole](/agentfootprint/api/generated/type-aliases/StageRole.md). Accepts a path-qualified id
(`sf-llm-call/call-llm`) — only the LOCAL segment matters, so it works at
any nesting depth. Built entirely from the id constants above, so adding a
stage to the chart only requires listing it here.

## Parameters

### id

`string`

## Returns

[`StageRole`](/agentfootprint/api/generated/type-aliases/StageRole.md)
