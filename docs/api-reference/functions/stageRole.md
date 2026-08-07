[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / stageRole

# Function: stageRole()

> **stageRole**(`id`): [`StageRole`](/agentfootprint/api/generated/type-aliases/StageRole.md)

Defined in: [src/conventions.ts:257](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/conventions.ts#L257)

Classify a stage id into its [StageRole](/agentfootprint/api/generated/type-aliases/StageRole.md). Accepts a path-qualified id
(`sf-llm-call/call-llm`) — only the LOCAL segment matters, so it works at
any nesting depth. Built entirely from the id constants above, so adding a
stage to the chart only requires listing it here.

## Parameters

### id

`string`

## Returns

[`StageRole`](/agentfootprint/api/generated/type-aliases/StageRole.md)
