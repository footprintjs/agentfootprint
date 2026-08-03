---
title: ToolOutcome
---

# Type Alias: ToolOutcome

> **ToolOutcome** = [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`Readonly`\<`Record`\<`string`, `unknown`\>\>\> \| [`DenyOutcome`](/docs/api/interfaces/DenyOutcome) \| [`AskOutcome`](/docs/api/interfaces/AskOutcome)

Defined in: [src/core/agent/middleware/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L93)

Everything a tool middleware may answer. Closed, and every arm has a
home in this codebase: allow rides the normal dispatch, deny rides the
synthetic tool result every other gate already uses, ask rides the
pausable-stage checkpoint that `checkIn` rides.
