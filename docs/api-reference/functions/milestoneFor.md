[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneFor

# Function: milestoneFor()

> **milestoneFor**(`id`): [`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

Defined in: [src/conventions.ts:465](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/conventions.ts#L465)

Classify a stage id into a [Milestone](/agentfootprint/api/generated/interfaces/Milestone.md), or `null` when the stage is NOT
a milestone boundary (its commits fold into the surrounding milestone's
collection). This is the DOMAIN's declaration of which steps are scrub-worthy;
the Lens consumes it to build the time-travel slider (see
agentfootprint-lens `cursorPositionsAtDrill`).

**Since 9.90.0 this is the FALLBACK, not the fact.** The charts declare the
same milestones as tags at build time ([milestoneTagsFor](/agentfootprint/api/generated/functions/milestoneTagsFor.md)), footprintjs
9.21 stamps them on the stage's first commit bundle (`CommitBundle.tags`), and
`milestoneStops` reads the bundle first — it derives from the id only for a
bundle that carries no tags (a recording made before 9.90.0). Every milestone
stage is declared, slot branch mounts included (footprintjs 9.21.1). Same
table either way, so the two readings agree.

Mirrors [stageRole](/agentfootprint/api/generated/functions/stageRole.md): accepts a runtimeStageId (`call-llm#17`), a
path-qualified id (`sf-llm-call/call-llm`), or a bare local id — only the
LOCAL stage segment matters, so it works at any nesting depth and for both
commit ids and subflow-group ids.

## Parameters

### id

`string`

## Returns

[`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`
