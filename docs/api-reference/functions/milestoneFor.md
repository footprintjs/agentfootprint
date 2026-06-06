[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneFor

# Function: milestoneFor()

> **milestoneFor**(`id`): [`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

Defined in: [src/conventions.ts:274](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/conventions.ts#L274)

Classify a stage id into a [Milestone](/agentfootprint/api/generated/interfaces/Milestone.md), or `null` when the stage is NOT
a milestone boundary (its commits fold into the surrounding milestone's
collection). This is the DOMAIN's declaration of which steps are scrub-worthy;
the Lens consumes it to build the time-travel slider (see
agentfootprint-lens `cursorPositionsAtDrill`).

Mirrors [stageRole](/agentfootprint/api/generated/functions/stageRole.md): accepts a runtimeStageId (`call-llm#17`), a
path-qualified id (`sf-llm-call/call-llm`), or a bare local id — only the
LOCAL stage segment matters, so it works at any nesting depth and for both
commit ids and subflow-group ids.

## Parameters

### id

`string`

## Returns

[`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`
