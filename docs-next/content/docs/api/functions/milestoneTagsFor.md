---
title: milestoneTagsFor
---

# Function: milestoneTagsFor()

> **milestoneTagsFor**(`localStageId`): readonly `string`[]

Defined in: [src/conventions.ts:508](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L508)

The tags to declare on the stage with this LOCAL id, from the same table
[milestoneFor](/docs/api/functions/milestoneFor) reads — so a chart-building site names the id it is
mounting and never spells a kind or a label. Throws at build time for an id
the table does not classify: a declaration site that is not a milestone is
a wiring mistake, and a silent no-op would be a forgotten tag by another name.

## Parameters

### localStageId

`string`

## Returns

readonly `string`[]

## Example

```ts
builder
  .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation')
  .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM));   // 'milestone:llm-turn', 'milestone-label:LLM turn'
```
