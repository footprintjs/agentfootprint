[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolOutcome

# Type Alias: ToolOutcome

> **ToolOutcome** = [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`Readonly`\<`Record`\<`string`, `unknown`\>\>\> \| [`DenyOutcome`](/agentfootprint/api/generated/interfaces/DenyOutcome.md) \| [`AskOutcome`](/agentfootprint/api/generated/interfaces/AskOutcome.md)

Defined in: [src/core/agent/middleware/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L124)

Everything a tool middleware may answer. Closed, and every arm has a
home in this codebase: allow rides the normal dispatch, deny rides the
synthetic tool result every other gate already uses, ask rides the
pausable-stage checkpoint that `checkIn` rides.
