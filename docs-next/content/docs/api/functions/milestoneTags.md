---
title: milestoneTags
---

# Function: milestoneTags()

> **milestoneTags**(`milestone`): readonly `string`[]

Defined in: [src/conventions.ts:491](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L491)

The tags that DECLARE a [Milestone](/docs/api/interfaces/Milestone) on a stage: its kind tag and its
label tag, in that order. What a declaration site spreads into `.tag(...)`
or `{ tags }`; what [milestoneFromTags](/docs/api/functions/milestoneFromTags) reads back.

## Parameters

### milestone

[`Milestone`](/docs/api/interfaces/Milestone)

## Returns

readonly `string`[]
