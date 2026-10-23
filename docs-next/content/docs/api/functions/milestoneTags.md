---
title: milestoneTags
---

# Function: milestoneTags()

> **milestoneTags**(`milestone`): readonly `string`[]

Defined in: [src/lib/conventions.ts:571](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/conventions.ts#L571)

The tags that DECLARE a [Milestone](/docs/api/interfaces/Milestone) on a stage: its kind tag and its
label tag, in that order. What a declaration site spreads into `.tag(...)`
or `{ tags }`; what [milestoneFromTags](/docs/api/functions/milestoneFromTags) reads back.

## Parameters

### milestone

[`Milestone`](/docs/api/interfaces/Milestone)

## Returns

readonly `string`[]
