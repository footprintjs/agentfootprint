[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AskComponent

# Interface: AskComponent

Defined in: [src/core/askComponent.ts:49](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/askComponent.ts#L49)

The typed half of a human ask: which REGISTERED screen component collects
the answer, and what it renders with.

Optional everywhere it appears — an ask without one is byte-identical to
every earlier release, and a screen that does not know the id falls back to
the prose `question` it always had. The decision the person makes returns
through the SAME structured field it always did (`HostRequest.decision`,
`checkInApproved` / `checkInDeclined`): the component changes how the
question is ASKED, never what the answer IS. The words a screen renders the
decision as are display; the structured decision is the record.

## Properties

### componentId

> `readonly` **componentId**: `string`

Defined in: [src/core/askComponent.ts:56](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/askComponent.ts#L56)

The id of a component registered in the consuming frontend — consumer
vocabulary, declared by whoever raises the ask, never interpreted here.
The registry maps it to a real component; this library never ships
markup or code under it (the no-eval law).

***

### props?

> `readonly` `optional` **props?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/askComponent.ts:62](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/askComponent.ts#L62)

Small inline props (plain JSON). These ride the ask — and therefore the
checkpoint and every stored session envelope — so keep them small; the
big half is what [propsRef](/agentfootprint/api/generated/interfaces/AskComponent.md#propsref) is for.

***

### propsRef?

> `readonly` `optional` **propsRef?**: `string`

Defined in: [src/core/askComponent.ts:70](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/askComponent.ts#L70)

Claim ticket for the big half — an artifact ref minted BEFORE the ask
(usually by the asking tool via `ctx.artifacts.put`). The options table
rides the STORE, not the checkpoint; the screen redeems it through the
artifact wire under the session's own scope. Validated to resolve at
raise time.
