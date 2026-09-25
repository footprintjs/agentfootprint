[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertAskComponent

# Function: assertAskComponent()

> **assertAskComponent**(`value`, `door`): `asserts value is AskComponent`

Defined in: [src/core/askComponent.ts:117](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/askComponent.ts#L117)

Refuse a malformed component BY NAME, at whichever door it arrived through.

Deliberately checks the three fields and nothing more: `componentId` is
consumer vocabulary (no charset opinion beyond "say something"), `props`
must be a plain object because it is spread into JSON payloads, and
`propsRef` must be a non-empty string because an empty ticket resolves
nothing. Whether the ref RESOLVES is a runtime question answered at raise
time by the dispatch loop, not here — this leaf has no store.

## Parameters

### value

`unknown`

### door

`string`

## Returns

`asserts value is AskComponent`
