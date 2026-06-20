---
title: milestoneFor
---

# Function: milestoneFor()

> **milestoneFor**(`id`): [`Milestone`](/docs/api/interfaces/Milestone) \| `null`

Defined in: [src/conventions.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L278)

Classify a stage id into a [Milestone](/docs/api/interfaces/Milestone), or `null` when the stage is NOT
a milestone boundary (its commits fold into the surrounding milestone's
collection). This is the DOMAIN's declaration of which steps are scrub-worthy;
the Lens consumes it to build the time-travel slider (see
agentfootprint-lens `cursorPositionsAtDrill`).

Mirrors [stageRole](/docs/api/functions/stageRole): accepts a runtimeStageId (`call-llm#17`), a
path-qualified id (`sf-llm-call/call-llm`), or a bare local id — only the
LOCAL stage segment matters, so it works at any nesting depth and for both
commit ids and subflow-group ids.

## Parameters

### id

`string`

## Returns

[`Milestone`](/docs/api/interfaces/Milestone) \| `null`
