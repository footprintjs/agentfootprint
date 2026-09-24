[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneTagsFor

# Function: milestoneTagsFor()

> **milestoneTagsFor**(`localStageId`): readonly `string`[]

Defined in: [src/conventions.ts:519](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/conventions.ts#L519)

The tags to declare on the stage with this LOCAL id, from the same table
[milestoneFor](/agentfootprint/api/generated/functions/milestoneFor.md) reads — so a chart-building site names the id it is
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
