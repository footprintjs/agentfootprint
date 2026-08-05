[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneFor

# Function: milestoneFor()

> **milestoneFor**(`id`): [`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

Defined in: [src/conventions.ts:303](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/conventions.ts#L303)

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
