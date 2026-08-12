[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / stageRole

# Function: stageRole()

> **stageRole**(`id`): [`StageRole`](/agentfootprint/api/generated/type-aliases/StageRole.md)

Defined in: [src/conventions.ts:257](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/conventions.ts#L257)

Classify a stage id into its [StageRole](/agentfootprint/api/generated/type-aliases/StageRole.md). Accepts a path-qualified id
(`sf-llm-call/call-llm`) — only the LOCAL segment matters, so it works at
any nesting depth. Built entirely from the id constants above, so adding a
stage to the chart only requires listing it here.

## Parameters

### id

`string`

## Returns

[`StageRole`](/agentfootprint/api/generated/type-aliases/StageRole.md)
