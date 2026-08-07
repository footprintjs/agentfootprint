[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolOutcome

# Type Alias: ToolOutcome

> **ToolOutcome** = [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`Readonly`\<`Record`\<`string`, `unknown`\>\>\> \| [`DenyOutcome`](/agentfootprint/api/generated/interfaces/DenyOutcome.md) \| [`AskOutcome`](/agentfootprint/api/generated/interfaces/AskOutcome.md)

Defined in: [src/core/agent/middleware/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/middleware/types.ts#L124)

Everything a tool middleware may answer. Closed, and every arm has a
home in this codebase: allow rides the normal dispatch, deny rides the
synthetic tool result every other gate already uses, ask rides the
pausable-stage checkpoint that `checkIn` rides.
