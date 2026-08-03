---
title: DenyOutcome
---

# Interface: DenyOutcome

Defined in: [src/core/agent/middleware/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L68)

Refuse the call. For a tool, `reason` reaches the model verbatim as the
tool result and the run continues — a denial is data the agent can adapt
to, not a crash. For a message, `reason` surfaces as a
`MessageDeniedError` at the API boundary.

## Properties

### kind

> `readonly` **kind**: `"deny"`

Defined in: [src/core/agent/middleware/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L69)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/middleware/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L70)
