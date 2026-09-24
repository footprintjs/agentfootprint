[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / NextStepInput

# Type Alias: NextStepInput\<TPreviousOutput\>

> **NextStepInput**\<`TPreviousOutput`\> = `TPreviousOutput` *extends* `string` ? `object` : `TPreviousOutput`

Defined in: [src/core-flow/Workflow.ts:93](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core-flow/Workflow.ts#L93)

What the NEXT step must accept, given what the previous one returns.

A `string` output feeds `{ message }` — the convention every runner in
this library already speaks (LLMCall, Agent, Sequence, Swarm). Anything
else is handed over as-is, so the next step's input type must be that
same type.

## Type Parameters

### TPreviousOutput

`TPreviousOutput`
