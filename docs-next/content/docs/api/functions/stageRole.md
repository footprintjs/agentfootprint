---
title: stageRole
---

# Function: stageRole()

> **stageRole**(`id`): [`StageRole`](/docs/api/type-aliases/StageRole)

Defined in: [src/conventions.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L232)

Classify a stage id into its [StageRole](/docs/api/type-aliases/StageRole). Accepts a path-qualified id
(`sf-llm-call/call-llm`) — only the LOCAL segment matters, so it works at
any nesting depth. Built entirely from the id constants above, so adding a
stage to the chart only requires listing it here.

## Parameters

### id

`string`

## Returns

[`StageRole`](/docs/api/type-aliases/StageRole)
