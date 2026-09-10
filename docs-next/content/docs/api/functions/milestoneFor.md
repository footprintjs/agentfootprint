---
title: milestoneFor
---

# Function: milestoneFor()

> **milestoneFor**(`id`): [`Milestone`](/docs/api/interfaces/Milestone) \| `null`

Defined in: [src/conventions.ts:454](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L454)

Classify a stage id into a [Milestone](/docs/api/interfaces/Milestone), or `null` when the stage is NOT
a milestone boundary (its commits fold into the surrounding milestone's
collection). This is the DOMAIN's declaration of which steps are scrub-worthy;
the Lens consumes it to build the time-travel slider (see
agentfootprint-lens `cursorPositionsAtDrill`).

**Since 9.90.0 this is the FALLBACK, not the fact.** The charts declare the
same milestones as tags at build time ([milestoneTagsFor](/docs/api/functions/milestoneTagsFor)), footprintjs
9.21 stamps them on the stage's first commit bundle (`CommitBundle.tags`), and
`milestoneStops` reads the bundle first — it derives from the id only for a
bundle that carries no tags (a recording made before 9.90.0, or a mount
footprintjs cannot tag yet). Same table either way, so the two readings agree.

Mirrors [stageRole](/docs/api/functions/stageRole): accepts a runtimeStageId (`call-llm#17`), a
path-qualified id (`sf-llm-call/call-llm`), or a bare local id — only the
LOCAL stage segment matters, so it works at any nesting depth and for both
commit ids and subflow-group ids.

## Parameters

### id

`string`

## Returns

[`Milestone`](/docs/api/interfaces/Milestone) \| `null`
