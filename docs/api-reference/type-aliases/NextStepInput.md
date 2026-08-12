[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / NextStepInput

# Type Alias: NextStepInput\<TPreviousOutput\>

> **NextStepInput**\<`TPreviousOutput`\> = `TPreviousOutput` *extends* `string` ? `object` : `TPreviousOutput`

Defined in: [src/core-flow/Workflow.ts:93](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Workflow.ts#L93)

What the NEXT step must accept, given what the previous one returns.

A `string` output feeds `{ message }` — the convention every runner in
this library already speaks (LLMCall, Agent, Sequence, Swarm). Anything
else is handed over as-is, so the next step's input type must be that
same type.

## Type Parameters

### TPreviousOutput

`TPreviousOutput`
