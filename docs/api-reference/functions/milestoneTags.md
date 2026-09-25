[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneTags

# Function: milestoneTags()

> **milestoneTags**(`milestone`): readonly `string`[]

Defined in: [src/conventions.ts:501](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/conventions.ts#L501)

The tags that DECLARE a [Milestone](/agentfootprint/api/generated/interfaces/Milestone.md) on a stage: its kind tag and its
label tag, in that order. What a declaration site spreads into `.tag(...)`
or `{ tags }`; what [milestoneFromTags](/agentfootprint/api/generated/functions/milestoneFromTags.md) reads back.

## Parameters

### milestone

[`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md)

## Returns

readonly `string`[]
